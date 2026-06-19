// src/engines/subtractive-mod-faithful.dsp.test.ts
// Layer-3 DSP test: the amber cutoff arc must PREDICT the audio (Subtractive).
//
// Same fix as the TB-303: the cutoff knob is normalized 0..1 and maps
// exponentially to Hz (60·220^x), so cutoff modulation is routed into
// BiquadFilterNode.detune (cents, multiplicative) instead of summing raw Hz
// into .frequency. A bipolar LFO at a moderate depth must sweep brightness
// without driving the filter shut on every trough.

import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from './subtractive';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { _resetLaneBindingsForTesting } from '../modulation/voice-mod-binding';

const SR   = 44100;
const DUR  = 1.5;
const MIDI = 45;

const SUS_START = Math.floor(0.2 * SR);
const SUS_END   = Math.floor(1.25 * SR);

function sustainWindowRms(buf: Float32Array, win = 2048): number[] {
  const out: number[] = [];
  for (let i = SUS_START; i + win <= SUS_END; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += buf[i + j] ** 2;
    out.push(Math.sqrt(s / win));
  }
  return out;
}

function sustainWindowCentroid(buf: Float32Array, win = 4096): number[] {
  const out: number[] = [];
  for (let i = SUS_START; i + win <= SUS_END; i += win) {
    out.push(spectralCentroid(buf.subarray(i, i + win), SR));
  }
  return out;
}

async function renderCutoffLFO(depth: number): Promise<Float32Array> {
  _resetLaneBindingsForTesting();
  setCurrentLaneForVoice('main');
  try {
    const engine = new SubtractiveEngine();
    engine.setBaseValue('filter.cutoff', 0.45);
    engine.setBaseValue('filter.resonance', 0.3);
    engine.setBaseValue('filter.envAmount', 0);   // isolate the LFO
    engine.setBaseValue('amp.attack',  0.01);
    engine.setBaseValue('amp.decay',   0.2);
    engine.setBaseValue('amp.sustain', 1.0);
    engine.setBaseValue('amp.release', 0.3);

    const lfo1 = engine.modulators.modulators.find((m) => m.id === 'lfo1')!;
    lfo1.enabled = true;
    lfo1.bipolar = true;
    lfo1.rateHz  = 4;
    lfo1.waveform = 'sine';
    lfo1.connections = [{ id: 'c-test', paramId: 'main.filter.cutoff', depth }];

    return renderEngine(
      (ctx) => {
        const output = (ctx as unknown as { createGain(): GainNode }).createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, output);
        return { voice, output };
      },
      {
        durationSec: DUR,
        sampleRate:  SR,
        events: [{ time: 0, type: 'trigger', midi: MIDI, gateDuration: DUR * 0.95 }],
      },
    );
  } finally {
    setCurrentLaneForVoice(null);
  }
}

describe('Subtractive — faithful cutoff modulation (audio matches the arc)', () => {
  it('a moderate LFO depth sweeps brightness WITHOUT slamming the filter shut', async () => {
    const buf = await renderCutoffLFO(0.25);

    const cent = sustainWindowCentroid(buf).filter((c) => c > 0);
    const cMin = Math.min(...cent);
    const cMax = Math.max(...cent);
    expect(cMax).toBeGreaterThan(cMin * 1.5);

    const rms = sustainWindowRms(buf);
    const rMean = rms.reduce((a, b) => a + b, 0) / rms.length;
    const rMin  = Math.min(...rms);
    expect(rMin).toBeGreaterThan(rMean * 0.3);
  });
});
