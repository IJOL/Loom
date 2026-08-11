/**
 * LED VU Meter — DOM-segments implementation.
 *
 * Public surface:
 *   createLevelMeter(opts)  → { el: HTMLElement, dispose(): void }
 *   registerMeter(handle)   — registers the meter with the shared RAF loop
 *
 * The shared RAF loop starts lazily on first `registerMeter` and stops
 * automatically when the last meter is disposed.
 *
 * Segment layout: 14 stacked LED divs rendered via `flex-direction: column-reverse`
 * so index 0 is at the bottom visually (low level = bottom).
 *
 * Color zones:
 *   Green  → segments 0–7  (bottom 8)
 *   Yellow → segments 8–11 (middle 4)
 *   Red    → segments 12–13 (top 2)
 *
 * The column is a ONE-TIME lit-html render into a detached fragment; the RAF
 * loop then flips `lit`/`lit-peak` classes imperatively on the kept segment
 * refs — per-frame work never goes through a template diff.
 */

import { createMeterColumn, type MeterColumnHandle } from './controls/meter-column';

// ── Scale constants ───────────────────────────────────────────────────────────

export const SEGMENT_COUNT = 14;

/**
 * Top-of-segment dBFS thresholds. `SEGMENT_TOPS_DB[i]` is the dB value at
 * which segment `i` becomes fully lit.  Monotonically increasing.
 *
 * Piecewise-linear mapping:
 *   Green  (0–7):  6 dB / segment covering ~−60 dBFS .. −12 dBFS
 *   Yellow (8–11): 2.25 dB / segment covering ~−12 dBFS .. −3 dBFS
 *   Red    (12–13): 1.5 dB / segment covering ~−3 dBFS .. 0 dBFS (clip)
 */
export const SEGMENT_TOPS_DB: readonly number[] = [
  -54, -48, -42, -36, -30, -24, -18, -12,   // green  0–7
  -9.75, -7.5, -5.25, -3,                    // yellow 8–11
  -1.5, 0,                                   // red    12–13
] as const;

export const SEGMENT_ZONES: readonly ('green' | 'yellow' | 'red')[] = [
  'green', 'green', 'green', 'green', 'green', 'green', 'green', 'green',
  'yellow', 'yellow', 'yellow', 'yellow',
  'red', 'red',
] as const;

/**
 * Returns the number of segments (0..SEGMENT_COUNT) that should be lit for a
 * given dBFS reading. Segment i is lit when `dbfs >= SEGMENT_TOPS_DB[i-1]`
 * (first segment lights at any signal above −∞).
 */
export function litCountForDb(dbfs: number): number {
  if (dbfs <= SEGMENT_TOPS_DB[0]) return dbfs > -90 ? 1 : 0;
  for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
    if (dbfs >= SEGMENT_TOPS_DB[i]) return i + 1;
  }
  return 0;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LevelMeterOpts {
  analyser: AnalyserNode;
}

export interface LevelMeterHandle {
  el: HTMLElement;
  dispose(): void;
}

interface MeterRegistration {
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  /** The segments and the peak marker, which know nothing about analysers —
   *  see controls/meter-column.ts. What is left here is the READING. */
  column: MeterColumnHandle;
  el: HTMLElement;
}

/** The RMS of what this analyser is carrying right now, in dBFS.
 *
 *  Exported because the meter is no longer the only reader: a panel plugin
 *  cannot hold an AnalyserNode, so the host answers "how loud is this lane" for
 *  it — and it must be the SAME reading the mixer's own meter shows, or the two
 *  disagree about a number the user can see in both places at once.
 *
 *  The floor is 1e-4 rather than 0 so silence reads as −80 dB instead of −∞. */
export function dbfsOf(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  return 20 * Math.log10(Math.max(rms, 1e-4));
}

// ── Shared RAF loop ───────────────────────────────────────────────────────────

const meters = new Set<MeterRegistration>();
let rafId: number | null = null;

function tick(now: number): void {
  for (const reg of meters) {
    reg.column.set(dbfsOf(reg.analyser, reg.buffer), now);
  }

  if (meters.size > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

export function registerMeter(reg: MeterRegistration): void {
  meters.add(reg);
  if (rafId === null) {
    rafId = requestAnimationFrame(tick);
  }
}

function unregisterMeter(reg: MeterRegistration): void {
  meters.delete(reg);
  if (meters.size === 0 && rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ── createLevelMeter ──────────────────────────────────────────────────────────

/**
 * Build a 14-segment LED VU meter column, mount it into `parent` (if provided
 * via opts), and register it with the shared RAF loop.
 *
 * Returns `{ el, dispose }`.  The caller is responsible for calling `dispose()`
 * when the column is removed — this unregisters from the RAF loop and removes
 * the DOM node.  The analyser node itself must be disconnected separately (e.g.
 * by calling `strip.getMeterAnalyser()` on the owning ChannelStrip then
 * disconnecting, or via `strip.dispose()`).
 */
export function createLevelMeter(opts: LevelMeterOpts): LevelMeterHandle {
  const { analyser } = opts;
  const column = createMeterColumn();
  const buffer = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
  const reg: MeterRegistration = { analyser, buffer, column, el: column.el };
  registerMeter(reg);
  return {
    el: column.el,
    dispose() {
      unregisterMeter(reg);
      column.el.remove();
    },
  };
}
