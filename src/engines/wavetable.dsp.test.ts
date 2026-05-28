// src/engines/wavetable.dsp.test.ts
// Layer-3: real DSP tests for the Wavetable engine.

import { describe, it, expect } from 'vitest';
import { WavetableEngine } from './wavetable';
import { runStandardEngineBattery } from '../../test/dsp-battery';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

runStandardEngineBattery({
  name: 'wavetable',
  createEngine: () => new WavetableEngine(),
  cutoffParamId: 'filter.cutoff',
  maxOutParams: {
    'filter.cutoff':    0.95,
    'filter.resonance': 0.9,
  },
  midi: 48,
});

describe('wavetable — morph position', () => {
  it('sweeping osc.morph changes the spectral centroid', async () => {
    const SR = 44100;
    const render = (pos: number) => {
      const engine = new WavetableEngine();
      engine.setBaseValue('osc.morph', pos);
      return renderEngine(
        (ctx) => {
          const out = ctx.createGain();
          const voice = engine.createVoice(ctx as unknown as AudioContext, out);
          voice.connect(out);
          return { voice, output: out };
        },
        {
          durationSec: 0.3, sampleRate: SR,
          events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.25 }],
        },
      );
    };
    const p0 = await render(0);
    const p1 = await render(1);
    writeWav(p0, wavPath('wavetable__pos-0'), SR);
    writeWav(p1, wavPath('wavetable__pos-1'), SR);
    expect(Math.abs(spectralCentroid(p0, SR) - spectralCentroid(p1, SR))).toBeGreaterThan(50);
  });
});
