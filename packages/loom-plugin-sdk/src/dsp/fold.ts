// src/audio-dsp/fold.ts
// Per-sample wavefolder equivalent to the WaveShaper curve in
// src/engines/westcoast-fold.ts. That curve is a sine-based fold:
//   curve[i] = Math.sin(x * FOLD_STAGES * Math.PI)  where x ∈ [-1, 1]
// Per-sample: same formula with drive scaling the input (matching
// foldDrive.gain = 0.1 + fold * 0.9 in WestVoice.trigger).
//
// drive is the foldDrive gain value (0.1..1+), already baked by the caller.
// We apply sin(input * FOLD_STAGES * π) — if the input is in [-1, 1] the
// WaveShaper curve maps it to sin(x*4π), giving up to 4 lobes of folding.
//
// Note: the WaveShaper clamps input to [-1, 1] before lookup. We replicate
// that by clamping here.

const FOLD_STAGES = 4;

/** Wavefold a sample. `input` is the post-mix, pre-drive signal in roughly
 *  [-1, 1]; `driveGain` is the foldDrive.gain (0.1 + fold * 0.9 * accentMul).
 *  Matches the WaveShaper curve from westcoast-fold.ts exactly. */
export function fold(input: number, driveGain: number): number {
  const x = Math.max(-1, Math.min(1, input * driveGain));
  return Math.sin(x * FOLD_STAGES * Math.PI);
}
