// src/engines/tb303-mod-faithful.dsp.test.ts
// Layer-3 DSP test: the amber modulation arc must PREDICT the audio.
//
// The TB-303 filter.cutoff knob is normalized 0..1 and maps EXPONENTIALLY to
// Hz inside the synth (`80 * 100^cutoff`). The modulation arc on the knob is
// drawn in that normalized 0..1 space — a bipolar LFO at depth d sweeps the
// arc between (x-d .. x+d). For "what you see == what you hear", the audio
// must sweep the cutoff between the SAME normalized endpoints, i.e. multiply
// the base frequency by 100^(±d).
//
// The historic bug summed the LFO LINEARLY in Hz with a full-band range
// (~18 kHz), so even a small depth subtracted thousands of Hz from a ~800 Hz
// base, driving filter.frequency negative for a large part of every cycle →
// the filter slammed fully shut → the note went silent ("se anula") on every
// trough, regardless of depth or base cutoff. This test pins the fix: at a
// moderate depth the modulated note must keep singing through the troughs
// (exponential modulation never closes the filter), not collapse to silence.

import { describe, it, expect } from 'vitest';
import { TB303Engine } from './tb303';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { _resetLaneBindingsForTesting } from '../modulation/voice-mod-binding';

const SR   = 44100;
const DUR  = 1.5;
const MIDI = 40;          // ~82 Hz — low note so the lowpass sweep is obvious

async function renderCutoffLFO(depth: number): Promise<Float32Array> {
  _resetLaneBindingsForTesting();
  setCurrentLaneForVoice('bass');
  try {
    const engine = new TB303Engine();
    engine.setBaseValue('filter.cutoff', 0.5);   // ~800 Hz base
    engine.setBaseValue('filter.resonance', 0.3);
    engine.setBaseValue('env.amount', 0);        // isolate the LFO from the filter env
    engine.setBaseValue('env.decay', 0.4);

    const lfo1 = engine.modulators.modulators.find((m) => m.id === 'lfo1')!;
    lfo1.enabled = true;
    lfo1.bipolar = true;
    lfo1.rateHz  = 4;
    lfo1.waveform = 'sine';
    lfo1.connections = depth > 0
      ? [{ id: 'c-test', paramId: 'bass.filter.cutoff', depth }]
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

// SUSTAIN region only (skip attack + release tails so the amp envelope can't
// masquerade as a modulation trough).
const SUS_START = Math.floor(0.15 * SR);
const SUS_END   = Math.floor(1.25 * SR);

/** Per-window RMS across the sustain region. */
function sustainWindowRms(buf: Float32Array, win = 2048): number[] {
  const out: number[] = [];
  for (let i = SUS_START; i + win <= SUS_END; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += buf[i + j] ** 2;
    out.push(Math.sqrt(s / win));
  }
  return out;
}

/** Per-window spectral centroid (brightness, Hz) across the sustain region. */
function sustainWindowCentroid(buf: Float32Array, win = 4096): number[] {
  const out: number[] = [];
  for (let i = SUS_START; i + win <= SUS_END; i += win) {
    out.push(spectralCentroid(buf.subarray(i, i + win), SR));
  }
  return out;
}

describe('TB-303 — faithful cutoff modulation (audio matches the arc)', () => {
  it('a moderate LFO depth sweeps brightness WITHOUT slamming the filter shut', async () => {
    const buf = await renderCutoffLFO(0.2);

    // 1) It must actually modulate: the brightness (spectral centroid) must
    //    swing clearly over the sustain as the cutoff sweeps up and down.
    const cent = sustainWindowCentroid(buf).filter((c) => c > 0);
    const cMin = Math.min(...cent);
    const cMax = Math.max(...cent);
    expect(cMax).toBeGreaterThan(cMin * 1.5);

    // 2) …but the troughs must NOT collapse to silence. With the old linear-Hz
    //    path the filter went fully closed each cycle (min RMS ≈ 0); faithful
    //    exponential modulation keeps the note singing through the trough.
    const rms = sustainWindowRms(buf);
    const rMean = rms.reduce((a, b) => a + b, 0) / rms.length;
    const rMin  = Math.min(...rms);
    expect(rMin).toBeGreaterThan(rMean * 0.3);
  });
});
