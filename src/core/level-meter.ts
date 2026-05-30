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
 */

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
  segments: HTMLDivElement[];
  buffer: Float32Array<ArrayBuffer>;
  lastLitCount: number;
  peak: {
    idx: number;       // segment index of peak (0-based), -1 = none
    heldUntil: number; // timestamp ms
    lastDecayAt: number;
  };
  el: HTMLElement;
}

// ── Shared RAF loop ───────────────────────────────────────────────────────────

const meters = new Set<MeterRegistration>();
let rafId: number | null = null;

function tick(now: number): void {
  for (const reg of meters) {
    // Measure RMS over time-domain buffer
    reg.analyser.getFloatTimeDomainData(reg.buffer);
    let sum = 0;
    const len = reg.buffer.length;
    for (let i = 0; i < len; i++) {
      sum += reg.buffer[i] * reg.buffer[i];
    }
    const rms = Math.sqrt(sum / len);
    const dbfs = 20 * Math.log10(Math.max(rms, 1e-4));

    const litCount = litCountForDb(dbfs);

    // Update lit segments (only touch class when state changes)
    if (litCount !== reg.lastLitCount) {
      const lo = Math.min(litCount, reg.lastLitCount);
      const hi = Math.max(litCount, reg.lastLitCount);
      for (let i = lo; i < hi; i++) {
        if (i < reg.segments.length) {
          reg.segments[i].classList.toggle('lit', i < litCount);
        }
      }
      reg.lastLitCount = litCount;
    }

    // Peak-hold logic
    const peakSegIdx = litCount - 1; // highest lit segment index (-1 if silent)
    const p = reg.peak;
    if (peakSegIdx >= p.idx) {
      // New peak: snap and reset hold timer
      if (p.idx >= 0 && p.idx < reg.segments.length) {
        reg.segments[p.idx].classList.remove('lit-peak');
      }
      p.idx = peakSegIdx;
      p.heldUntil = now + 1500;
      if (p.idx >= 0 && p.idx < reg.segments.length) {
        reg.segments[p.idx].classList.add('lit-peak');
      }
    } else if (now > p.heldUntil && now > p.lastDecayAt + 120) {
      // Hold expired: decay one segment
      if (p.idx >= 0 && p.idx < reg.segments.length) {
        reg.segments[p.idx].classList.remove('lit-peak');
      }
      p.idx--;
      p.lastDecayAt = now;
      if (p.idx >= 0 && p.idx < reg.segments.length) {
        reg.segments[p.idx].classList.add('lit-peak');
      }
    }
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

  // Root container
  const el = document.createElement('div');
  el.className = 'mix-vu-host';

  const column = document.createElement('div');
  column.className = 'mix-vu';
  el.appendChild(column);

  // Build segments bottom-first; CSS flex-direction: column-reverse makes
  // index 0 appear at the bottom visually.
  const segments: HTMLDivElement[] = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const seg = document.createElement('div');
    seg.className = `mix-vu-seg mix-vu-seg--${SEGMENT_ZONES[i]}`;
    column.appendChild(seg);
    segments.push(seg);
  }

  const bufferSize = analyser.fftSize; // fftSize=512 → 512 time-domain samples
  const buffer = new Float32Array(bufferSize) as Float32Array<ArrayBuffer>;

  const reg: MeterRegistration = {
    analyser,
    segments,
    buffer,
    lastLitCount: 0,
    peak: { idx: -1, heldUntil: 0, lastDecayAt: 0 },
    el,
  };

  registerMeter(reg);

  return {
    el,
    dispose() {
      unregisterMeter(reg);
      el.remove();
    },
  };
}
