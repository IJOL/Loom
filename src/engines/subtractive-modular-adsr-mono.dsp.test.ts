// src/engines/subtractive-modular-adsr-mono.dsp.test.ts
//
// Layer-3 DSP — characterizes WHY the modular ADSR sounds "nothing like" the
// built-in poly envelope on a chord. Both renders play the SAME 3-note chord
// through the SAME real polyhost trigger path (one createVoice + trigger per
// note, exactly like src/app/trigger-dispatch.ts), differing only in which
// envelope drives the amp:
//
//   built-in  — PolySynth's per-voice internal amp env (amp.builtinEnv = on).
//               Each voice owns its own envAmp ConstantSource → truly
//               polyphonic: all three chord tones sustain together.
//
//   modular   — the per-voice modular ADSR is the ONLY amp driver
//               (amp.builtinEnv = off, adsr-amp depth=1 → amp.gain).
//
// REQUIRED behaviour (this test asserts the FIX, not the bug): the modular
// ADSR must be a real polyphonic amp driver. A 3-note chord driven solely by
// the modular ADSR (built-in env bypassed) must keep ALL three tones sounding,
// exactly like the built-in per-voice env does — so a user can switch the
// built-in envelope off and rely on the modular ADSR instead.
//
// Regression guarded: previously a lane kept a SINGLE per-voice modulator
// binding slot, so every new note ran bindVoiceModulators →
// lb.voiceBinding.binder.disposeAll() and disconnected the PREVIOUS voice's
// modulator→amp.gain bridge (connection-binder.ts:69). With the built-in env
// bypassed the earlier voices then had no amp driver → silence → the modular
// ADSR was effectively MONOPHONIC. The fix keeps one binding per live voice
// (bounded by the engine's polyphony), so each chord voice retains its own
// modulator bridge for the full note.

import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from './subtractive';
import { writeWav, wavPath } from '../../test/wav';
import { peak } from '../../test/dsp-asserts';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { _resetLaneBindingsForTesting } from '../modulation/voice-mod-binding';

const SR = 44100;
const DUR = 0.6;
const GATE = 0.5;
const CHORD = [48, 52, 55]; // C3, E3, G3 — a C-major triad. G3 is triggered last.

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Goertzel magnitude at `freq` over the sample window [start, start+len).
 *  Single-bin DFT power → magnitude, normalised by window length so it is
 *  comparable across windows. Used to ask "is this note's fundamental present
 *  in the rendered chord?" without an FFT bin-alignment dance. */
function toneMag(buf: Float32Array, start: number, len: number, freq: number, sr: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < len; i++) {
    const s0 = buf[start + i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / len;
}

type AmpMode = 'builtin' | 'modular';

async function renderChord(mode: AmpMode): Promise<Float32Array> {
  // Each render is its own lane-binding world — the binder map is module-global.
  _resetLaneBindingsForTesting();

  const ctx = new OfflineAudioContext(1, Math.round(DUR * SR), SR);
  const engine = new SubtractiveEngine();

  // Spectrum hygiene: kill the sub-oscillator + noise (broadband / octave-below
  // energy that would muddy a per-fundamental measurement) and park the filter
  // open & flat with NO cutoff envelope, so amplitude is the ONLY thing that
  // differs between the two modes.
  engine.setBaseValue('sub.level', 0);
  engine.setBaseValue('noise.level', 0);
  engine.setBaseValue('filter.cutoff', 0.6);
  engine.setBaseValue('filter.resonance', 0.1);
  engine.setBaseValue('filter.envAmount', 0);
  engine.setBaseValue('amp.attack', 0.01);
  engine.setBaseValue('amp.decay', 0.1);
  engine.setBaseValue('amp.sustain', 0.9);
  engine.setBaseValue('amp.release', 0.2);

  const adsrAmp = engine.modulators.modulators.find((m) => m.id === 'adsr-amp')!;
  if (mode === 'builtin') {
    // Integrated per-voice amp env drives the amp; the modular ADSR contributes
    // nothing (depth 0) — this is the engine's default shipping state.
    engine.setBaseValue('amp.builtinEnv', 1);
    adsrAmp.connections = [{ id: 'c-amp', paramId: 'amp.gain', depth: 0 }];
  } else {
    // Bypass the integrated amp env → the modular ADSR is the SOLE amp driver.
    engine.setBaseValue('amp.builtinEnv', 0);
    adsrAmp.enabled = true;
    adsrAmp.attackSec = 0.01;
    adsrAmp.decaySec = 0.1;
    adsrAmp.sustain = 0.9;
    adsrAmp.releaseSec = 0.2;
    adsrAmp.connections = [{ id: 'c-amp', paramId: 'amp.gain', depth: 1.0 }];
  }

  const out = (ctx as unknown as { createGain(): GainNode }).createGain();
  out.connect(ctx.destination);

  // Faithfully replay src/app/trigger-dispatch.ts: the polyhost calls
  // createVoice ON EVERY NOTE, with the current lane set so the per-voice
  // modulator binder runs and (re)binds to the freshly-allocated voice.
  for (const midi of CHORD) {
    setCurrentLaneForVoice('main');
    const v = engine.createVoice(ctx as unknown as AudioContext, out);
    setCurrentLaneForVoice(null);
    v.trigger(midi, 0, { gateDuration: GATE });
  }

  const rendered = await ctx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

/** Per-fundamental energy over the chord's sustain region (after attack+decay,
 *  before release): [C, E, G]. G is the last-triggered note. */
function chordToneEnergies(buf: Float32Array): { eC: number; eE: number; eG: number } {
  const start = Math.floor(0.15 * SR);
  const len = Math.floor(0.30 * SR);
  const [fC, fE, fG] = CHORD.map(midiToFreq);
  return {
    eC: toneMag(buf, start, len, fC, SR),
    eE: toneMag(buf, start, len, fE, SR),
    eG: toneMag(buf, start, len, fG, SR),
  };
}

describe('Subtractive — built-in vs modular ADSR on a chord (real DSP)', () => {
  it('both the built-in poly env AND the modular ADSR sustain all three chord tones', async () => {
    const builtin = await renderChord('builtin');
    const modular = await renderChord('modular');

    writeWav(builtin, wavPath('subtractive__chord-builtin-adsr'), SR);
    writeWav(modular, wavPath('subtractive__chord-modular-adsr'), SR);

    const b = chordToneEnergies(builtin);
    const m = chordToneEnergies(modular);

    // Sanity: both renders are audible (G — the surviving note — sounds in both).
    // Relative floor mirrors the sibling built-in-env DSP tests.
    expect(peak(builtin)).toBeGreaterThan(0.001);
    expect(peak(modular)).toBeGreaterThan(0.001);

    // ── Built-in: POLYPHONIC ──────────────────────────────────────────────
    // The two earlier notes (C, E) each carry energy comparable to the last
    // note (G) — the whole triad is sounding together.
    expect(b.eC).toBeGreaterThan(b.eG * 0.3);
    expect(b.eE).toBeGreaterThan(b.eG * 0.3);

    // ── Modular: POLYPHONIC (the fix) ─────────────────────────────────────
    // All three tones sustain together — the earlier notes (C, E) each carry
    // energy comparable to the last note (G), just like the built-in env. Each
    // chord voice keeps its own modulator→amp.gain bridge for the whole note.
    expect(m.eC).toBeGreaterThan(m.eG * 0.3);
    expect(m.eE).toBeGreaterThan(m.eG * 0.3);

    // ── The modular path is as polyphonic as the built-in one ─────────────
    // "How present are the non-last notes, relative to the last note?" must NOT
    // collapse going from built-in to modular — the modular chord stays within
    // a comparable band of the built-in chord (gain-independent statement of
    // "the modular ADSR no longer forces the chord to mono").
    const polyRatioBuiltin = (b.eC + b.eE) / b.eG;
    const polyRatioModular = (m.eC + m.eE) / m.eG;
    expect(polyRatioModular).toBeGreaterThan(polyRatioBuiltin * 0.5);
  });
});
