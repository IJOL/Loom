// src/samples/sample-loudness.ts
// Peak-normalization for keymap samples (drumkits + multisample instruments).
//
// WHY: the bundled drumkits arrive at wildly different levels — most are already
// peak-normalized to ~0 dBFS, but a handful (TR-808, Acoustic, the GM-percussion
// VCSL set) sit 5-7 dB below that, so they sound noticeably quieter than the rest
// of the kit library. Measuring each decoded buffer's true peak once and applying
// a boost toward a common target evens the library out without touching the ones
// already at full scale. It is PEAK-based (not RMS): boosting toward a peak target
// can never push the asset past the target, so it cannot introduce clipping — the
// drums-vs-synth balance stays a separate, single trim (DrumsWorkletEngine.SAMPLE_GAIN).
//
// Scope: applied only to keymap-resolved spawns (one-shot pads + repitched zones),
// NOT to audio clips / loops / stems, whose level is an intentional part of the mix.

/** True peak (max |sample|) across all channels of a decoded buffer. */
export function bufferPeak(buf: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = data[i] < 0 ? -data[i] : data[i];
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** Linear gain that lifts `peak` toward `targetDb`, boost-only and capped at
 *  `maxBoostDb` (so a near-silent file's noise floor is not amplified into hiss).
 *  Returns 1 for a peak already at/above target or a silent/invalid buffer. */
export function peakNormGain(
  peak: number,
  opts: { targetDb?: number; maxBoostDb?: number } = {},
): number {
  const targetDb = opts.targetDb ?? -1;
  const maxBoostDb = opts.maxBoostDb ?? 12;
  if (!(peak > 0)) return 1;
  const target = Math.pow(10, targetDb / 20);
  const maxBoost = Math.pow(10, maxBoostDb / 20);
  const g = target / peak;
  return Math.min(maxBoost, Math.max(1, g));
}
