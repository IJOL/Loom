// src/engines/wavetable-mod-faithful.dsp.test.ts
// Repro + guard: a shared LFO routed to filter.cutoff on the Wavetable engine
// must audibly sweep the brightness (same detune-based fix as the other
// engines). User reported "el LFO modular contra cutoff no hace nada".

import { describe, it, expect } from 'vitest';
import { WavetableEngine } from './wavetable';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { _resetLaneBindingsForTesting } from '../modulation/voice-mod-binding';

const SR   = 44100;
const DUR  = 1.5;
const MIDI = 48;

const SUS_START = Math.floor(0.2 * SR);
const SUS_END   = Math.floor(1.25 * SR);

function sustainWindowCentroid(buf: Float32Array, win = 4096): number[] {
  const out: number[] = [];
  for (let i = SUS_START; i + win <= SUS_END; i += win) {
    out.push(spectralCentroid(buf.subarray(i, i + win), SR));
  }
  return out;
}

async function render(depth: number, scope: 'shared' | 'per-voice' = 'shared'): Promise<Float32Array> {
  _resetLaneBindingsForTesting();
  setCurrentLaneForVoice('wt-lane');
  try {
    const engine = new WavetableEngine();
    engine.setBaseValue('filter.cutoff', 0.4);
    engine.setBaseValue('filter.resonance', 0.3);
    engine.setBaseValue('amp.attack', 0.01);
    engine.setBaseValue('amp.decay', 0.2);
    engine.setBaseValue('amp.sustain', 1.0);
    engine.setBaseValue('amp.release', 0.3);

    // Disable the default per-voice adsr1→cutoff so the LFO is the only
    // brightness source, and route the LFO to filter.cutoff.
    const adsr1 = engine.modulators.modulators.find((m) => m.id === 'adsr1');
    if (adsr1) adsr1.enabled = false;
    const lfo1 = engine.modulators.modulators.find((m) => m.id === 'lfo1')!;
    lfo1.enabled = true;
    lfo1.bipolar = true;
    lfo1.rateHz = 4;
    lfo1.waveform = 'sine';
    lfo1.scope = scope;
    lfo1.connections = depth > 0
      ? [{ id: 'c-test', paramId: 'wt-lane.filter.cutoff', depth }]
      : [];

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

describe('Wavetable — LFO → cutoff actually modulates', () => {
  it('SHARED LFO sweeps brightness over time (not a static timbre)', async () => {
    const cent = sustainWindowCentroid(await render(0.6, 'shared')).filter((c) => c > 0);
    expect(Math.max(...cent)).toBeGreaterThan(Math.min(...cent) * 1.5);
  });

  it('PER-VOICE LFO sweeps brightness over time too', async () => {
    const cent = sustainWindowCentroid(await render(0.6, 'per-voice')).filter((c) => c > 0);
    expect(Math.max(...cent)).toBeGreaterThan(Math.min(...cent) * 1.5);
  });
});
