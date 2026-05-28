// src/engines/tb303.dsp.test.ts
// Layer-3: real DSP tests for the TB-303 engine.

import { describe, it, expect } from 'vitest';
import { TB303Engine } from './tb303';
import { runStandardEngineBattery } from '../../test/dsp-battery';
import { renderEngine } from '../../test/render';
import { freqContour } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

runStandardEngineBattery({
  name: 'tb303',
  createEngine: () => new TB303Engine(),
  cutoffParamId: 'filter.cutoff',
  maxOutParams: {
    'filter.cutoff':    0.95,
    'filter.resonance': 0.9,
    'env.amount':       0.9,
  },
});

describe('tb303 — slide', () => {
  it('two consecutive triggers with slide produce a continuous freq contour', async () => {
    const engine = new TB303Engine();
    const SR = 44100;
    const buf = await renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      {
        durationSec: 0.6, sampleRate: SR,
        events: [
          { time: 0.0,  type: 'trigger', midi: 36, gateDuration: 0.4, slide: true },
          { time: 0.25, type: 'trigger', midi: 43, gateDuration: 0.25, slide: false },
        ],
      },
    );
    writeWav(buf, wavPath('tb303__slide'), SR);

    const contour = freqContour(buf, SR, 20);
    const nonZero = contour.filter(f => f > 30);
    expect(nonZero.length).toBeGreaterThan(contour.length / 2);
    let maxJump = 0;
    for (let i = 1; i < nonZero.length; i++) {
      const ratio = nonZero[i] / nonZero[i - 1];
      maxJump = Math.max(maxJump, ratio, 1 / ratio);
    }
    expect(maxJump).toBeLessThan(2.5);
  });
});
