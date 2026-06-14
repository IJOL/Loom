// src/engines/westcoast-fold.ts
// Wavefolder transfer curve for the West Coast engine.
// A multi-fold sine over the input domain [-1, 1]: foldDrive pushes the signal
// toward the edges where the curve folds repeatedly, adding harmonics, while a
// signal near 0 passes almost linearly. Built once and shared by all voices.

export const FOLD_STAGES = 4;

export function makeFoldCurve(stages: number = FOLD_STAGES, n: number = 4096): Float32Array {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // -1..1
    curve[i] = Math.sin(x * stages * Math.PI);
  }
  return curve;
}
