// Velocity → note colour: a 2-colour blue→yellow ramp, blue-weighted (pivot 0.5).
// Single source of truth for the piano-roll and drum-grid note fills + velocity bars.
const BLUE      = [48, 134, 212] as const;
const LITE_BLUE = [80, 170, 234] as const;
const YELLOW    = [244, 222, 74] as const;
const PIVOT = 0.5;

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function rgbLerp(a: readonly number[], b: readonly number[], t: number): string {
  const c = [0, 1, 2].map((i) => Math.round(lerp(a[i], b[i], t)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** 0..127 → CSS rgb() string. Blue holds (slight lift) up to the pivot, then ramps to yellow. */
export function velToColor(velocity: number): string {
  const t = Math.max(0, Math.min(127, velocity)) / 127;
  if (t <= PIVOT) return rgbLerp(BLUE, LITE_BLUE, t / PIVOT);
  return rgbLerp(LITE_BLUE, YELLOW, (t - PIVOT) / (1 - PIVOT));
}
