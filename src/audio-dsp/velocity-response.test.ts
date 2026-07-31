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

// Every melodic engine shares the owner's curve (src/core/velocity-gain.ts) —
// which is the whole claim, so the list is not maintained here.
const ON_CURVE = MELODIC_IDS;
// Engines whose accent touches the amp and NOTHING else, so their RMS ratio is a
// clean read of the punch factor. tb303 and westcoast are the two that also move
// timbre, each with its own claim below.
const AMP_ONLY = ['wavetable', 'fm'];
// Two engines "agree" within this much. Renderers are deterministic and velocity is
// a pure gain, so agreement here is exact to floating point — measured spread 0.00%
// across all six engines. 2% is slack, not a real tolerance.
const AGREE = 0.02;
// Looser band for engines whose accent ALSO changes timbre, so their RMS ratio is
// not a clean read of the amp punch.
const AGREE_LOOSE = 0.05;

describe('cross-engine velocity + accent response', () => {
  it('velocity response shape is the same across engines', () => {
    // Measured: 0.45000 on all six (= velGain01(0.3) / velGain01(1)). fm and
    // karplus read 0.30000 until the port's lost curve was restored — a soft note
    // a third quieter on those two than on the rest, which is exactly how a MIDI
    // import's quiet passages went missing when a clip was pointed at fm.
    const ref = velocityShape('wavetable');
    for (const id of ON_CURVE) {
      expect(velocityShape(id) / ref).toBeGreaterThan(1 - AGREE);
      expect(velocityShape(id) / ref).toBeLessThan(1 + AGREE);
    }
  });

  it('accent gain ratio is consistent across engines', () => {
    // Measured: wavetable 1.100, fm 1.100, karplus 1.100, subtractive 1.098,
    // tb303 1.222, westcoast 0.943 (the last two have their own claims below).
    const ref = accentRatio('wavetable');   // amp-only, uses the shared ACCENT_PUNCH
    // Accent must never make a note quieter — on every engine whose accent only
    // touches the amp, or brightens a filter that does not eat the extra level.
    for (const id of MELODIC_IDS.filter((i) => i !== 'westcoast')) {
      expect(accentRatio(id)).toBeGreaterThan(1);
    }

    // The three amp-only engines punch by the same factor, so accent programming
    // survives re-pointing a clip at another engine. fm and karplus read 1.3 here
    // until the port's lost curve was restored — the accent was carried by a stray
    // multiplier of its own rather than by the shared ACCENT_PUNCH.
    for (const id of AMP_ONLY) {
      expect(accentRatio(id) / ref).toBeGreaterThan(1 - AGREE);
      expect(accentRatio(id) / ref).toBeLessThan(1 + AGREE);
    }

    // tb303 is the DECLARED EXCEPTION: its accent also raises Q, and a diode ladder
    // loses level as Q climbs, so it opts into a bigger VCA punch (ACCENT_VCA_LADDER)
    // to still read as an accent. Even after the ladder eats part of it (1.3 → 1.22
    // measured), it lands above the shared punch — which is the whole point.
    expect(accentRatio('tb303')).toBeGreaterThan(ref);

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

  // Restoring the curve on fm multiplies a full-velocity note by velGain01(1) =
  // 1.4, so the engine would have come out 2.9 dB louder against every other
  // lane. ENGINE_TRIM.fm was divided by that 1.4 to put it back — and this is
  // the case that says "back where", because a trim is exactly the kind of
  // number that gets nudged by ear and never checked.
  //
  // The constant is MEASURED, not chosen: fm's full-velocity RMS over
  // wavetable's, read off this same fixture before the curve landed. It is a
  // ratio between engines, so it says nothing about absolute level — only that
  // the balance between lanes is the one the demos were mixed against.
  // Re-measure and update it deliberately if an engine is re-voiced.
  //
  // The plucked string got the SAME ÷1.4 at the same time and its half of this
  // claim still exists — it moved to plugins/karplus/dsp.test.ts, because its
  // renderer is no longer importable from src/.
  it('the curve fix left fm sitting where it sat against wavetable', () => {
    const fullLevel = (id: string): number => rmsOf(makeRenderer(id, note({ velocity: LOUD })));
    const ref = fullLevel('wavetable');
    const FM_VS_WAVETABLE = 0.16686;
    // 1% covers rounding the trim to three decimals (0.25/1.4 → 0.179).
    expect(fullLevel('fm') / ref / FM_VS_WAVETABLE).toBeCloseTo(1, 2);
  });
});
