// src/engines/fm.dsp.test.ts
// Layer-3: real DSP tests for the FM engine.

import { describe, it, expect } from 'vitest';
import { FMEngine } from './fm';
import { runStandardEngineBattery } from '../../test/dsp-battery';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

// FM has no traditional filter — it relies on operator ratios for brightness.
// We omit cutoffParamId and replace with a ratio test below.
runStandardEngineBattery({
  name: 'fm',
  createEngine: () => new FMEngine(),
  midi: 48,
  maxOutParams: {
    'op1.level': 1.0,
    'op2.level': 1.0,
    'amp.mix':   1.0,
  },
});

describe('fm — operator ratio', () => {
  it('raising op2.ratio raises the spectral centroid', async () => {
    const SR = 44100;
    const render = (ratio: number) => {
      const engine = new FMEngine();
      engine.setBaseValue('op2.ratio', ratio);
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
    const lo = await render(1);
    const hi = await render(8);
    writeWav(lo, wavPath('fm__ratio-lo'), SR);
    writeWav(hi, wavPath('fm__ratio-hi'), SR);
    expect(spectralCentroid(hi, SR)).toBeGreaterThan(spectralCentroid(lo, SR) * 1.5);
  });
});
