// src/engines/westcoast.dsp.test.ts
// Layer-3: real DSP tests for the West Coast engine.
import { describe, it, expect } from 'vitest';
import { WestEngine } from './westcoast';
import { runStandardEngineBattery } from '../../test/dsp-battery';
import { renderEngine } from '../../test/render';
import { spectralCentroid, rms } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

runStandardEngineBattery({
  name: 'westcoast',
  createEngine: () => new WestEngine(),
  cutoffParamId: 'lpg.cutoff',
  maxOutParams: {
    'timbre.fold': 1.0,
    'lpg.cutoff': 0.95,
    'lpg.resonance': 0.9,
    'osc.fmIndex': 1.0,
  },
  midi: 48,
});

// ── Task 4: Wavefolder characterization ──────────────────────────────────────
describe('westcoast — wavefolder', () => {
  const SR = 44100;
  const render = (fold: number) => {
    const engine = new WestEngine();
    engine.setBaseValue('timbre.fold', fold);
    engine.setBaseValue('lpg.mode', 1); // gate: keep filter wide open so fold's
    engine.setBaseValue('lpg.cutoff', 1); // harmonics are not filtered away
    return renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      { durationSec: 0.3, sampleRate: SR,
        events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.25 }] },
    );
  };

  it('more fold raises the spectral centroid', async () => {
    const low = await render(0.0);
    const hi = await render(1.0);
    writeWav(low, wavPath('westcoast__fold-low'), SR);
    writeWav(hi, wavPath('westcoast__fold-hi'), SR);
    expect(spectralCentroid(hi, SR)).toBeGreaterThan(spectralCentroid(low, SR) * 1.3);
  });
});

// ── Task 5: Complex oscillator characterization ───────────────────────────────
describe('westcoast — complex oscillator', () => {
  const SR = 44100;
  const renderWith = (setup: (e: WestEngine) => void) => {
    const engine = new WestEngine();
    engine.setBaseValue('timbre.fold', 0); // isolate osc interaction from folding
    engine.setBaseValue('lpg.mode', 1);
    engine.setBaseValue('lpg.cutoff', 1);
    setup(engine);
    return renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      { durationSec: 0.3, sampleRate: SR,
        events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.25 }] },
    );
  };

  it('FM index raises the spectral centroid (sidebands)', async () => {
    const clean = await renderWith((e) => e.setBaseValue('osc.fmIndex', 0));
    const fm = await renderWith((e) => { e.setBaseValue('osc.fmIndex', 1); e.setBaseValue('osc.ratio', 3); });
    writeWav(clean, wavPath('westcoast__fm-off'), SR);
    writeWav(fm, wavPath('westcoast__fm-on'), SR);
    expect(spectralCentroid(fm, SR)).toBeGreaterThan(spectralCentroid(clean, SR) * 1.2);
  });

  it('ring/AM produces audible output', async () => {
    const ring = await renderWith((e) => { e.setBaseValue('osc.ring', 1); e.setBaseValue('osc.ratio', 1.5); });
    writeWav(ring, wavPath('westcoast__ring'), SR);
    expect(rms(ring)).toBeGreaterThan(0.001);
  });
});

// ── Task 6: Low-pass gate contour characterization ────────────────────────────
describe('westcoast — low-pass gate contour', () => {
  const SR = 44100;
  const renderDecay = (decay: number) => {
    const engine = new WestEngine();
    engine.setBaseValue('contour.mode', 0); // pluck
    engine.setBaseValue('contour.decay', decay);
    engine.setBaseValue('lpg.mode', 2); // both
    return renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      { durationSec: 0.6, sampleRate: SR,
        events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.5 }] },
    );
  };

  it('a short pluck decays faster than a long one', async () => {
    const shortP = await renderDecay(0.05);
    const longP = await renderDecay(0.5);
    writeWav(shortP, wavPath('westcoast__pluck-short'), SR);
    writeWav(longP, wavPath('westcoast__pluck-long'), SR);
    const win = (b: Float32Array) => b.subarray(Math.round(0.2 * SR), Math.round(0.4 * SR));
    expect(rms(win(longP))).toBeGreaterThan(rms(win(shortP)) * 3);
  });
});
