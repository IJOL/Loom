// Pure math for the arrangement ruler loop brace (whole-bar snap).
export function pxToBar(px: number, pxPerBar: number): number {
  if (pxPerBar <= 0) return 0;
  return Math.max(0, Math.round(px / pxPerBar));
}
export function clampBarRegion(
  start: number, end: number, totalBars: number,
): { start: number; end: number } {
  let a = Math.max(0, Math.min(totalBars, Math.min(start, end)));
  let b = Math.max(0, Math.min(totalBars, Math.max(start, end)));
  if (b - a < 1) b = Math.min(totalBars, a + 1);
  if (b - a < 1) a = Math.max(0, b - 1);
  return { start: a, end: b };
}
