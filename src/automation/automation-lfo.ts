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
// 'stepped' lanes are quantised afterwards by snapLaneToSteps(), which keeps ONE
// value per step (sub-sample 0) and throws the rest away. That is destructive, so
// the fill has to know about it: pass `stepSubRes` and it paints the staircase
// itself — one value per step, sampled at the step's CENTRE — which both survives
// the snap untouched and keeps a shape at the fast rates (see the rate limits).

import { clamp01 } from '../audio-dsp/dsp-util';

export type LfoShape = 'sine' | 'triangle' | 'sawUp' | 'sawDown' | 'square' | 'random';

export interface LfoFill {
  shape: LfoShape;
  /**
   * Cycles per bar. The UI thinks in cycles per REGION and converts with
   * cyclesToCyclesPerBar(); anything above the ceiling is clamped, and a
   * nonsense value falls back to one cycle per bar.
   */
  cyclesPerBar: number;
  /** Peak-to-peak amount: depth 1 around center 0.5 spans the whole 0..1 lane. */
  depth: number;
  /** Where the wave sits vertically, in lane units (0..1). */
  center: number;
  /** Rotation of the wave, in cycles. Whole cycles are equivalent to no shift. */
  phase: number;
  /**
   * Sub-step that counts as phase 0. Default 0 — the clip start, which keeps the
   * wave in phase with the bars. Set it to the start of the window when the user
   * asked for "N cycles inside THIS region": a count only means something if the
   * first cycle begins where the region does. Affects the phase only; on a
   * stepped lane the staircase is still read off the absolute index.
   */
  originSub?: number;
  /** Seed for 'random', so the same fill always paints the same steps. */
  seed?: number;
  /**
   * Sub-samples per step on a 'stepped' lane (AUTOMATION_SUB_RES). Set it and the
   * fill paints one value per step — sampled at the step centre and held across
   * it — so snapLaneToSteps() has nothing left to throw away. Leave it out (or
   * below 2) for a continuous lane, which keeps every sub-sample.
   */
  stepSubRes?: number;
}

// ── Rate limits ────────────────────────────────────────────────────────────
//
// The user asks for a number of CYCLES over the region being painted; internally
// that is still a rate against the bar, because the curve has to line up with
// bars and steps to be useful and an envelope has no sample rate of its own.
//
// The fast end stops at 16 cycles per bar, which is exactly ONE cycle per 1/16
// step. That is the ceiling the automation resolution can express: a step is the
// finest position the lane addresses (and a 'stepped' lane literally collapses to
// one value per step), so anything faster has less than one step per cycle and
// aliases into a slower, arbitrary-looking pattern instead of the shape the user
// picked. clampCyclesPerBar enforces it.
//
// There is no slow floor in here any more. The old one (4 bars) existed because
// the fixed rate MENU had to stop somewhere; with the count expressed per region
// "how slow is still useful" is the region's business, and the UI enforces its
// own LFO_MIN_CYCLES against what the user can see.
//
// A 'stepped' lane is one octave stricter. It keeps a single value per step, so a
// cycle needs at least TWO steps to show a high and a low — the step Nyquist,
// i.e. 8 cycles per bar at 16 steps per bar. At exactly one cycle per step every
// step lands on the same cycle phase and the lane collapses to a constant: before
// this was handled, "stepped + Sine + 1/16" painted a dead flat 0.5 and the LFO
// button looked broken. maxCyclesPerBar() reports that ceiling and a stepped fill
// clamps to it instead of aliasing.
//
// Remaining debt, deliberately not taken here: LFO_MAX_CYCLES_PER_BAR still
// assumes a bar is 16 steps. `subResPerBar` is the caller's (the clip lane passes
// the session meter's bar), so in 3/4 the same 16 cycles land on a 12-step bar —
// more than one cycle per step. Lowering the cap to stepsPerBar(meter) would
// change the ceiling in every non-4/4 session, which is an owner's call.
// Pinned by automation-lfo-meter.test.ts so it is found, not rediscovered.
export const LFO_MAX_CYCLES_PER_BAR = 16;
/** Steps a cycle needs on a stepped lane to still read as a wave. */
export const LFO_MIN_STEPS_PER_CYCLE = 2;
/** Fewest cycles the UI lets you ask for over a region — a quarter of a wave. */
export const LFO_MIN_CYCLES = 0.25;

export const LFO_SHAPES: ReadonlyArray<{ id: LfoShape; label: string }> = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'sawUp', label: 'Saw up' },
  { id: 'sawDown', label: 'Saw down' },
  { id: 'square', label: 'Square' },
  { id: 'random', label: 'Random' },
];

export const DEFAULT_LFO_FILL: LfoFill = {
  shape: 'sine', cyclesPerBar: 1, depth: 1, center: 0.5, phase: 0, seed: 1, originSub: 0,
};

/** Ceiling only: a rate that is zero, negative or not a number is meaningless,
 *  so it falls back to one cycle per bar rather than to some arbitrary edge. */
export function clampCyclesPerBar(cyclesPerBar: number): number {
  if (!Number.isFinite(cyclesPerBar) || cyclesPerBar <= 0) return DEFAULT_LFO_FILL.cyclesPerBar;
  return Math.min(LFO_MAX_CYCLES_PER_BAR, cyclesPerBar);
}

/** 0 for a continuous lane; otherwise the sub-samples one step holds. */
function stepSubResOf(stepSubRes: number | undefined): number {
  if (stepSubRes == null || !Number.isFinite(stepSubRes)) return 0;
  const n = Math.floor(stepSubRes);
  return n >= 2 ? n : 0; // 1 sub-sample per step IS a continuous lane
}

/**
 * Fastest rate this lane can express: the musical ceiling for a continuous lane,
 * halved (per step) for a 'stepped' one, which needs LFO_MIN_STEPS_PER_CYCLE
 * steps per cycle to avoid collapsing into a constant.
 */
export function maxCyclesPerBar(subResPerBar: number, stepSubRes?: number): number {
  const perBar = subResPerBar > 0 ? subResPerBar : 1;
  const ceiling = Math.min(LFO_MAX_CYCLES_PER_BAR, perBar);
  const stepSub = stepSubResOf(stepSubRes);
  if (!stepSub) return ceiling;
  return Math.min(ceiling, perBar / (stepSub * LFO_MIN_STEPS_PER_CYCLE));
}

// ── Cycles over a region ───────────────────────────────────────────────────
//
// The UI counts cycles over the stretch it is about to paint ("4 cycles in this
// loop"), which is the only count that makes a wave close cleanly inside a loop.
// The fill still works in cycles per bar, so these three translate between the
// two — and they are the single owner of that arithmetic, so nothing downstream
// gets to re-derive it.

/** Bars a region is worth. 0 for a degenerate region, so callers can guard. */
function regionBars(regionSubs: number, subResPerBar: number): number {
  if (!(regionSubs > 0) || !(subResPerBar > 0)) return 0;
  return regionSubs / subResPerBar;
}

/** "N cycles over this region" as the per-bar rate the fill actually uses. */
export function cyclesToCyclesPerBar(
  cycles: number, regionSubs: number, subResPerBar: number,
): number {
  const bars = regionBars(regionSubs, subResPerBar);
  if (!bars || !Number.isFinite(cycles)) return DEFAULT_LFO_FILL.cyclesPerBar;
  return cycles / bars;
}

/** Most cycles this lane can express over `regionSubs`, in the user's unit. */
export function maxCyclesInRegion(
  regionSubs: number, subResPerBar: number, stepSubRes?: number,
): number {
  const bars = regionBars(regionSubs, subResPerBar);
  if (!bars) return LFO_MIN_CYCLES;
  return maxCyclesPerBar(subResPerBar, stepSubRes) * bars;
}

/**
 * The cycle count the UI is allowed to hold: at least LFO_MIN_CYCLES, at most
 * what the lane can paint. The ceiling wins if the region is too short to hold
 * even the floor, so this never returns something the fill would alias.
 */
export function clampCyclesInRegion(
  cycles: number, regionSubs: number, subResPerBar: number, stepSubRes?: number,
): number {
  const max = maxCyclesInRegion(regionSubs, subResPerBar, stepSubRes);
  const wanted = Number.isFinite(cycles) ? cycles : DEFAULT_LFO_FILL.cyclesPerBar;
  return Math.min(max, Math.max(LFO_MIN_CYCLES, wanted));
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
  /** 0 = continuous; otherwise sub-samples per held step. */
  stepSub: number;
  /** Sub-step that counts as phase 0. */
  origin: number;
}

function resolve(cfg: LfoFill, subResPerBar: number): Resolved {
  const stepSub = stepSubResOf(cfg.stepSubRes);
  return {
    shape: cfg.shape,
    // a stepped lane cannot express the fast end, so clamp instead of aliasing
    cyclesPerBar: Math.min(
      clampCyclesPerBar(cfg.cyclesPerBar),
      maxCyclesPerBar(subResPerBar, stepSub),
    ),
    // depth is peak-to-peak, so each side of center gets half of it
    half: finite(cfg.depth, DEFAULT_LFO_FILL.depth) / 2,
    center: clamp01(finite(cfg.center, DEFAULT_LFO_FILL.center)),
    // only the fractional part matters: a whole-cycle shift is no shift at all
    // (this is also what keeps 'random' reproducible under phase = 1)
    phase: fract(finite(cfg.phase, 0)),
    seed: Math.trunc(finite(cfg.seed ?? DEFAULT_LFO_FILL.seed ?? 0, 0)),
    stepSub,
    origin: finite(cfg.originSub ?? 0, 0),
  };
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function sampleAt(r: Resolved, subIdx: number, subResPerBar: number): number {
  // On a stepped lane the step is the finest thing the user hears, so read the
  // wave at the CENTRE of the step and hold that value across it: sub-sample 0 —
  // what snapLaneToSteps keeps — would sit on the step boundary, and boundaries
  // are exactly where fast rates repeat the same phase and flatten the curve.
  const pos = r.stepSub > 0 ? (Math.floor(subIdx / r.stepSub) + 0.5) * r.stepSub : subIdx;
  // `origin` shifts the PHASE only — `pos` above stays absolute, so the staircase
  // keeps landing on the lane's own step grid whatever the origin is.
  const cyc = ((pos - r.origin) / subResPerBar) * r.cyclesPerBar + r.phase;
  return clamp01(r.center + bipolar(r.shape, cyc, r.seed) * r.half);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Single sub-step of the curve, for previews and hover read-outs. Sampled from
 * the same maths fillLfo uses, so a preview can never drift from the paint.
 */
export function lfoValueAt(cfg: LfoFill, subIdx: number, subResPerBar: number): number {
  const perBar = subResPerBar > 0 ? subResPerBar : 1;
  return sampleAt(resolve(cfg, perBar), Math.max(0, subIdx), perBar);
}

/**
 * Write the curve into `values[from, to)` in place. The window is clamped to the
 * array, so an out-of-range range is a partial fill, never a resize; `from >= to`
 * is a no-op. Phase 0 sits at `cfg.originSub` (default sub-step 0), so leaving it
 * alone makes a windowed fill land exactly where the same fill over the whole
 * lane would have put it, while passing `from` makes the wave start at the
 * window. With `cfg.stepSubRes` set the result is already one held value per
 * step (a stepped lane's own shape).
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
  const r = resolve(cfg, perBar);
  for (let i = lo; i < hi; i++) values[i] = sampleAt(r, i, perBar);
}
