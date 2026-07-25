// Paint an LFO-shaped curve into a clip automation envelope — "an LFO, but
// drawn as automation". This file is the pure maths only; the button, the menu
// and the undo wiring live with the automation lane UI.
//
// An envelope is a flat number[] of values in 0..1, sampled AUTOMATION_SUB_RES
// times per 1/16 step, 16 steps per bar (so a bar is 16 * AUTOMATION_SUB_RES
// sub-steps — passed in as `subResPerBar` to keep this module free of layout
// assumptions). The array reference is shared with the live audio path, so a
// fill writes IN PLACE and never resizes, replaces or reallocates it.
//
// 'stepped' lanes are quantised afterwards by snapLaneToSteps(), which keeps the
// first sub-sample of each step; nothing here needs to know about that.

import { clamp01 } from '../audio-dsp/dsp-util';

export type LfoShape = 'sine' | 'triangle' | 'sawUp' | 'sawDown' | 'square' | 'random';

export interface LfoFill {
  shape: LfoShape;
  /** Cycles per bar. Pick one from LFO_RATES; out-of-range values are clamped. */
  cyclesPerBar: number;
  /** Peak-to-peak amount: depth 1 around center 0.5 spans the whole 0..1 lane. */
  depth: number;
  /** Where the wave sits vertically, in lane units (0..1). */
  center: number;
  /** Rotation of the wave, in cycles. Whole cycles are equivalent to no shift. */
  phase: number;
  /** Seed for 'random', so the same fill always paints the same steps. */
  seed?: number;
}

export interface LfoRate {
  id: string;
  label: string;
  cyclesPerBar: number;
}

// ── Rate limits ────────────────────────────────────────────────────────────
//
// Rates are musical divisions, not Hz: the curve has to line up with bars and
// steps to be useful, and an envelope has no sample rate of its own.
//
// The fast end stops at 1/16 = 16 cycles per bar, which is exactly ONE cycle per
// 1/16 step. That is the ceiling the automation resolution can express: a step
// is the finest position the lane addresses (and a 'stepped' lane literally
// collapses to one value per step), so anything faster has less than one step
// per cycle and aliases into a slower, arbitrary-looking pattern instead of the
// shape the user picked. It is therefore not offered — and clampCyclesPerBar
// enforces it for values arriving from elsewhere.
//
// The slow end stops at 4 bars: below that the "wave" is a single ramp across
// clips longer than anything the lane editor shows at once.
export const LFO_MIN_CYCLES_PER_BAR = 0.25;
export const LFO_MAX_CYCLES_PER_BAR = 16;

export const LFO_RATES: ReadonlyArray<LfoRate> = [
  { id: '4bars', label: '4 bars', cyclesPerBar: 0.25 },
  { id: '2bars', label: '2 bars', cyclesPerBar: 0.5 },
  { id: '1bar', label: '1 bar', cyclesPerBar: 1 },
  { id: '1/2', label: '1/2', cyclesPerBar: 2 },
  { id: '1/4', label: '1/4', cyclesPerBar: 4 },
  { id: '1/8', label: '1/8', cyclesPerBar: 8 },
  { id: '1/16', label: '1/16', cyclesPerBar: 16 },
];

export const LFO_SHAPES: ReadonlyArray<{ id: LfoShape; label: string }> = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'sawUp', label: 'Saw up' },
  { id: 'sawDown', label: 'Saw down' },
  { id: 'square', label: 'Square' },
  { id: 'random', label: 'Random' },
];

export const DEFAULT_LFO_FILL: LfoFill = {
  shape: 'sine', cyclesPerBar: 1, depth: 1, center: 0.5, phase: 0, seed: 1,
};

export function clampCyclesPerBar(cyclesPerBar: number): number {
  if (!Number.isFinite(cyclesPerBar)) return DEFAULT_LFO_FILL.cyclesPerBar;
  return Math.max(LFO_MIN_CYCLES_PER_BAR, Math.min(LFO_MAX_CYCLES_PER_BAR, cyclesPerBar));
}

export function rateById(id: string): LfoRate | undefined {
  return LFO_RATES.find((r) => r.id === id);
}

// ── Waveforms ──────────────────────────────────────────────────────────────

const TWO_PI = Math.PI * 2;

/**
 * Deterministic 0..1 hash — 'random' is a seeded step-hold, never Math.random(),
 * so a fill is reproducible (and testable) for the same seed and cycle.
 */
function hash01(seed: number, cycle: number): number {
  let h = (Math.imul((seed | 0) + 0x6d2b79f5, 0x9e3779b1) ^ Math.imul((cycle | 0) + 1, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bipolar -1..1 sample of `shape` at absolute cycle position `cyc` (>= 0). */
function bipolar(shape: LfoShape, cyc: number, seed: number): number {
  const t = cyc - Math.floor(cyc); // position inside the cycle, 0..1
  switch (shape) {
    case 'sine': return Math.sin(TWO_PI * t);
    // 0 → +1 → 0 → -1 → 0: a constant slope that reverses at each extreme
    case 'triangle': return t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4;
    case 'sawUp': return 2 * t - 1;
    case 'sawDown': return 1 - 2 * t;
    case 'square': return t < 0.5 ? 1 : -1;
    case 'random': return 2 * hash01(seed, Math.floor(cyc)) - 1;
  }
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** Normalised config: cheap to compute once per fill, reused per sample. */
interface Resolved {
  shape: LfoShape;
  cyclesPerBar: number;
  half: number;
  center: number;
  phase: number;
  seed: number;
}

function resolve(cfg: LfoFill): Resolved {
  return {
    shape: cfg.shape,
    cyclesPerBar: clampCyclesPerBar(cfg.cyclesPerBar),
    // depth is peak-to-peak, so each side of center gets half of it
    half: finite(cfg.depth, DEFAULT_LFO_FILL.depth) / 2,
    center: clamp01(finite(cfg.center, DEFAULT_LFO_FILL.center)),
    // only the fractional part matters: a whole-cycle shift is no shift at all
    // (this is also what keeps 'random' reproducible under phase = 1)
    phase: fract(finite(cfg.phase, 0)),
    seed: Math.trunc(finite(cfg.seed ?? DEFAULT_LFO_FILL.seed ?? 0, 0)),
  };
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function sampleAt(r: Resolved, subIdx: number, subResPerBar: number): number {
  const cyc = (subIdx / subResPerBar) * r.cyclesPerBar + r.phase;
  return clamp01(r.center + bipolar(r.shape, cyc, r.seed) * r.half);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Single sub-step of the curve, for previews and hover read-outs. Sampled from
 * the same maths fillLfo uses, so a preview can never drift from the paint.
 */
export function lfoValueAt(cfg: LfoFill, subIdx: number, subResPerBar: number): number {
  const perBar = subResPerBar > 0 ? subResPerBar : 1;
  return sampleAt(resolve(cfg), Math.max(0, subIdx), perBar);
}

/**
 * Write the curve into `values[from, to)` in place. The window is clamped to the
 * array, so an out-of-range range is a partial fill, never a resize; `from >= to`
 * is a no-op. Sub-step 0 is bar 0 phase 0, so a windowed fill lands exactly
 * where the same fill over the whole lane would have put it.
 */
export function fillLfo(
  values: number[],
  from: number,
  to: number,
  subResPerBar: number,
  cfg: LfoFill,
): void {
  const lo = Math.max(0, Math.floor(finite(from, 0)));
  const hi = Math.min(values.length, Math.floor(finite(to, 0)));
  if (hi <= lo) return;
  const perBar = subResPerBar > 0 ? subResPerBar : 1;
  const r = resolve(cfg);
  for (let i = lo; i < hi; i++) values[i] = sampleAt(r, i, perBar);
}
