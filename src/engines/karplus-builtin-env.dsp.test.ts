// src/engines/karplus-builtin-env.dsp.test.ts
// Layer-3 DSP: KarplusEngine amp.builtinEnv flag. Standalone render (no lane
// binder) → built-in amp env is the only amp driver, so Off must silence the
// voice (the pre-rendered string buffer still plays, but amp.gain stays 0).
import { describe, it, expect } from 'vitest';
import { KarplusEngine } from './karplus';
import { renderEngine } from '../../test/render';
import { rms } from '../../test/dsp-asserts';

const SR = 44100;

function factory(configure: (e: KarplusEngine) => void) {
  return (ctx: OfflineAudioContext) => {
    const output = (ctx as unknown as { createGain(): GainNode }).createGain();
    const engine = new KarplusEngine();
    configure(engine);
    const voice = engine.createVoice(ctx as unknown as AudioContext, output);
    return { voice, output };
  };
}

async function renderKarp(configure: (e: KarplusEngine) => void): Promise<Float32Array> {
  return renderEngine(factory(configure), {
    durationSec: 0.4,
    sampleRate: SR,
    events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.2 }],
  });
}

describe('KarplusEngine built-in amp env bypass (DSP)', () => {
  it('amp.builtinEnv Off silences the standalone voice; On is audible', async () => {
    const on  = await renderKarp((e) => e.setBaseValue('amp.builtinEnv', 1));
    const off = await renderKarp((e) => e.setBaseValue('amp.builtinEnv', 0));
    expect(rms(on)).toBeGreaterThan(0.001);
    // Wider silence margin than the subtractive test (*0.02): Karplus sums the
    // shared modBus['amp.level'] ConstantSource (at 0) into amp.gain, which can
    // contribute a hair of fp-noise — still essentially silent.
    expect(rms(off)).toBeLessThan(rms(on) * 0.05);
  });
});
