// Pure helpers for "when does a scene/clip switch happen" — the switch instant
// T is the end of the loop that GOVERNS the currently-playing material.

/**
 * The governing loop length given the lengths of every currently-playing loop.
 * Rule (user-approved): sort the lengths WITH DUPLICATES (multiset) descending,
 * then while the single largest element is more than 2× the next element, drop
 * that one largest element and re-compare. The largest survivor governs.
 * `lengths` may be in seconds or bars (the ratio test is scale-free).
 */
export function governingLoopSec(lengths: number[]): number {
  const sorted = lengths.filter((l) => l > 0).sort((a, b) => b - a);
  if (sorted.length === 0) return 0;
  let i = 0;
  while (i < sorted.length - 1 && sorted[i] > 2 * sorted[i + 1]) i++;
  return sorted[i];
}
