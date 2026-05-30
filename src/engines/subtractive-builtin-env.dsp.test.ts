// src/engines/subtractive-builtin-env.dsp.test.ts
// Layer-3 DSP: SubtractiveEngine's amp.builtinEnv / filter.builtinEnv flags
// reach the rendered audio. renderEngine runs standalone (no lane binder), so
// the built-in envelope is the only amp driver — Off must silence the voice.
import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from './subtractive';
import { renderEngine } from '../../test/render';
import { rms, spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

function factory(configure: (e: SubtractiveEngine) => void) {
  return (ctx: OfflineAudioContext) => {
    const output = (ctx as unknown as { createGain(): GainNode }).createGain();
    const engine = new SubtractiveEngine();
    configure(engine);
    const voice = engine.createVoice(ctx as unknown as AudioContext, output);
    return { voice, output };
  };
}

async function renderSub(configure: (e: SubtractiveEngine) => void): Promise<Float32Array> {
  return renderEngine(factory(configure), {
    durationSec: 0.4,
    sampleRate: SR,
    events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.2 }],
  });
}

describe('SubtractiveEngine built-in envelope bypass (DSP)', () => {
  it('amp.builtinEnv Off silences the standalone voice; On is audible', async () => {
    const on  = await renderSub((e) => e.setBaseValue('amp.builtinEnv', 1));
    const off = await renderSub((e) => e.setBaseValue('amp.builtinEnv', 0));
    expect(rms(on)).toBeGreaterThan(0.001);
    expect(rms(off)).toBeLessThan(rms(on) * 0.02);
  });

  it('filter.builtinEnv Off removes the cutoff sweep (lower centroid)', async () => {
    const cfg = (e: SubtractiveEngine) => {
      e.setBaseValue('filter.cutoff', 0.1);
      e.setBaseValue('filter.envAmount', 1.0);
      e.setBaseValue('filter.attack', 0.005);
      e.setBaseValue('filter.sustain', 0.9);
    };
    const on  = await renderSub((e) => { cfg(e); e.setBaseValue('filter.builtinEnv', 1); });
    const off = await renderSub((e) => { cfg(e); e.setBaseValue('filter.builtinEnv', 0); });
    expect(spectralCentroid(on, SR)).toBeGreaterThan(spectralCentroid(off, SR) * 1.2);
  });
});
