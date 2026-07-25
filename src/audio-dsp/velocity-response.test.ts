// src/audio-dsp/velocity-response.test.ts
//
// Cross-engine velocity + accent response — the guard the duplication audit
// (2026-07-25, concern #2) found missing. Six worklet renderers each re-inlined
// "note velocity + accent flag → this voice's gain" with three incompatible
// formulas, and nothing noticed: the only accent test in the repo asserted
// "accent raises RMS", which is true at any factor. So the AudioWorklet port could
// drop the velocity curve from fm and karplus and stay green.
//
// The claims here are ratios BETWEEN engines, never a level: pointing the same
// clip at another engine must not change its dynamics.
//
// Why RMS is a fair proxy for the gain: in all six renderers the velocity factor
// is applied AFTER every nonlinearity (fm's tanh, westcoast's fold, the ladders),
// so it is a pure output gain and rms(lo)/rms(hi) IS the gain ratio.
import { describe, it, expect } from 'vitest';
import type { VoiceRenderer } from './types';
import { SR, note, makeRenderer, MELODIC_IDS } from '../../test/engine-fixtures';

const WINDOW_SEC = 0.05;

function rmsOf(v: VoiceRenderer): number {
  const n = Math.floor(SR * WINDOW_SEC);
  let acc = 0;
  for (let i = 0; i < n; i++) { const s = v.renderSample(i / SR); acc += s * s; }
  return Math.sqrt(acc / n);
}

function peakOf(v: VoiceRenderer): number {
  const n = Math.floor(SR * WINDOW_SEC);
  let p = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(v.renderSample(i / SR)); if (a > p) p = a; }
  return p;
}

/** rms(v=SOFT) / rms(v=LOUD) — the shape of an engine's velocity response. */
const SOFT = 0.3;
const LOUD = 1.0;
const velocityShape = (id: string): number =>
  rmsOf(makeRenderer(id, note({ velocity: SOFT }))) / rmsOf(makeRenderer(id, note({ velocity: LOUD })));

/** rms(accent) / rms(no accent) at the same velocity. */
const accentRatio = (id: string): number =>
  rmsOf(makeRenderer(id, note({ accent: true }))) / rmsOf(makeRenderer(id, note({ accent: false })));

/** peak(accent) / peak(no accent) — does the transient still punch? */
const accentPeakRatio = (id: string): number =>
  peakOf(makeRenderer(id, note({ accent: true }))) / peakOf(makeRenderer(id, note({ accent: false })));

// Engines that already share the owner's curve (src/core/velocity-gain.ts).
const ON_CURVE = ['tb303', 'wavetable', 'subtractive', 'westcoast'];
// Two engines "agree" within this much. Renderers are deterministic and velocity is
// a pure gain, so agreement here is exact to floating point — measured spread 0.00%
// across the four on-curve engines. 2% is slack, not a real tolerance.
const AGREE = 0.02;
// Looser band for engines whose accent ALSO changes timbre, so their RMS ratio is
// not a clean read of the amp punch.
const AGREE_LOOSE = 0.05;

describe('cross-engine velocity + accent response', () => {
  it('velocity response shape is the same across engines', () => {
    // Measured: 0.45000 on all four on-curve engines (= velGain01(0.3)/velGain01(1)),
    // 0.30000 on fm/karplus (raw velocity, curve lost).
    const ref = velocityShape('wavetable');
    for (const id of ON_CURVE) {
      expect(velocityShape(id) / ref).toBeGreaterThan(1 - AGREE);
      expect(velocityShape(id) / ref).toBeLessThan(1 + AGREE);
    }
    // DOCUMENTED REGRESSION — fm and karplus scale raw velocity (no `0.3 + 1.1·v`):
    // the AudioWorklet port dropped the curve. A soft note is a third quieter on
    // those two than on the four above, so re-pointing a clip at fm changes its
    // dynamics. Step 4 of the audit fixes both; when it lands this loop goes RED —
    // that is the signal to move 'fm' and 'karplus' into ON_CURVE and delete it.
    for (const id of ['fm', 'karplus']) {
      expect(velocityShape(id) / ref).toBeLessThan(1 - AGREE);
    }
  });

  it('accent gain ratio is consistent across engines', () => {
    // Measured: wavetable 1.100, subtractive 1.098, tb303 1.222, fm 1.300,
    // karplus 1.300, westcoast 0.943 (see its own claim below).
    const ref = accentRatio('wavetable');   // amp-only, uses the shared ACCENT_PUNCH
    // Accent must never make a note quieter — on every engine whose accent only
    // touches the amp, or brightens a filter that does not eat the extra level.
    const AMP_LOUDER = MELODIC_IDS.filter((id) => id !== 'westcoast');
    for (const id of AMP_LOUDER) expect(accentRatio(id)).toBeGreaterThan(1);

    // tb303 is the DECLARED EXCEPTION: its accent also raises Q, and a diode ladder
    // loses level as Q climbs, so it opts into a bigger VCA punch (ACCENT_VCA_LADDER)
    // to still read as an accent. Even after the ladder eats part of it (1.3 → 1.22
    // measured), it lands above the shared punch — which is the whole point.
    expect(accentRatio('tb303')).toBeGreaterThan(ref);

    // DOCUMENTED REGRESSION — fm and karplus are the other two amp-only engines, so
    // their RMS ratio IS their punch factor, and it is 1.3 where the shared value is
    // 1.1: accent programming does not survive changing a clip's engine. Step 4
    // makes all three agree, at which point these two go RED and become
    // `toBeLessThan(1 + AGREE)`.
    expect(accentRatio('fm') / ref).toBeGreaterThan(1 + AGREE);
    expect(accentRatio('karplus') / ref).toBeGreaterThan(1 + AGREE);
    // ...and they are wrong in the SAME way, which is what makes it one bug.
    expect(accentRatio('fm') / accentRatio('karplus')).toBeCloseTo(1, 3);

    // subtractive also brightens on accent (filter-env range), so its RMS mixes
    // loudness with timbre. It still lands within 5% of the shared punch.
    expect(accentRatio('subtractive') / ref).toBeGreaterThan(1 - AGREE_LOOSE);
    expect(accentRatio('subtractive') / ref).toBeLessThan(1 + AGREE_LOOSE);

    // westcoast is the engine where accent is genuinely a TIMBRE control: it drives
    // the wavefolder harder and opens the LPG contour further. Folding trades level
    // for harmonics (measured: ×0.858 on its own), so once the amp punch is the
    // shared 1.1 instead of the fold's 1.3 — the conflation step 3 undid — an
    // accented note measures QUIETER in RMS (0.943) while being brighter and
    // peakier. That is the legacy WestVoice behaviour, and it is why the punch
    // itself is measured in isolation over in westcoast-renderer.test.ts rather
    // than read off an RMS the folder has already spent.
    expect(accentRatio('westcoast')).toBeLessThan(ref);
    expect(accentPeakRatio('westcoast')).toBeGreaterThan(1);
  });
});
