// The inverse of the LFO painter.
//
// The LFO module describes a shape and draws it for you; this takes the shape
// you drew and turns it into a curve. Same destination, same region, opposite
// direction of authorship.

export type StepMode = 'hold' | 'ramp';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function fillSteps(values: number[], mode: StepMode, subs: number): number[] {
  const out = new Array<number>(Math.max(0, subs)).fill(0);
  if (values.length === 0 || subs <= 0) return out;

  const n = values.length;
  for (let i = 0; i < subs; i++) {
    const pos = (i / subs) * n;                     // 0..n
    const idx = Math.min(n - 1, Math.floor(pos));
    if (mode === 'hold') {
      out[i] = clamp01(values[idx]);
      continue;
    }
    // Ramp towards the NEXT step, wrapping past the last one back to the
    // first, so a painted curve closes on itself inside the region. Without
    // the wrap every loop would jump at the seam.
    const frac = pos - idx;
    const a = clamp01(values[idx]);
    const b = clamp01(values[(idx + 1) % n]);
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** The four shortcut buttons.
 *
 *  `rand` is injected so the random preset is reproducible in a test. Reaching
 *  for Math.random inside would make the one preset that most needs pinning the
 *  one that cannot be pinned at all. */
export function stepPreset(
  kind: 'up' | 'down' | 'invert' | 'random',
  count: number,
  current: number[],
  rand: () => number,
): number[] {
  const n = Math.max(1, count);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // A single step has no span to ramp across; n - 1 would be zero.
    const t = n === 1 ? 0 : i / (n - 1);
    // A missing current value reads as 0, so inverting a short array still
    // returns `count` entries rather than a ragged one.
    const cur = clamp01(current[i] ?? 0);
    out[i] = kind === 'up' ? t
      : kind === 'down' ? 1 - t
        : kind === 'invert' ? 1 - cur
          : clamp01(rand());
  }
  return out;
}
