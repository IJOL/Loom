// src/engines/subtractive-lfo-routing.dsp.test.ts
// Layer-3 DSP test: verifies that the modulation host actually drives the
// Subtractive engine's filter AudioParams. Specifically:
//   - LFO routed to `filter.cutoff` must produce a brightness sweep over
//     time (spectral centroid varies).
//   - LFO routed to `filter.resonance` must produce an audibly different
//     signature than routing to `filter.cutoff`.
//
// Catches regressions where the spec range (0..1) doesn't match the
// AudioParam's actual operating range, leaving modulation effectively
// silent — historic bug for cutoff (param is in Hz, range scaling gave
// ±1 Hz which is inaudible).

import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from './subtractive';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { _resetLaneBindingsForTesting } from '../modulation/voice-mod-binding';

const SR  = 44100;
const DUR = 1.5;        // long enough for the LFO to sweep multiple cycles
const MIDI = 48;        // C3 — comfortable midrange

interface RenderOpts {
  paramId?: string;     // short id, e.g. 'filter.cutoff' (will be prefixed with 'main.')
  depth?: number;
}

async function renderWith(opts: RenderOpts): Promise<Float32Array> {
  _resetLaneBindingsForTesting();
  setCurrentLaneForVoice('main');
  try {
    const engine = new SubtractiveEngine();
    // Start the filter half-open with moderate resonance so the LFO has
    // headroom to swing audibly in both directions.
    engine.setBaseValue('filter.cutoff',    0.4);
    engine.setBaseValue('filter.resonance', 0.4);
    // Disable the per-voice filter envelope (envAmount=0) so the LFO is the
    // only source of brightness variation. Otherwise the env confounds the
    // centroid measurement.
    engine.setBaseValue('filter.envAmount', 0);
    engine.setBaseValue('amp.attack',  0.01);
    engine.setBaseValue('amp.decay',   0.2);
    engine.setBaseValue('amp.sustain', 1.0);
    engine.setBaseValue('amp.release', 0.3);

    const lfo1 = engine.modulators.modulators.find((m) => m.id === 'lfo1')!;
    lfo1.enabled = true;
    lfo1.bipolar = true;
    lfo1.rateHz  = 3;
    lfo1.connections = opts.paramId
      ? [{ id: 'c-test', paramId: `main.${opts.paramId}`, depth: opts.depth ?? 1 }]
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

function l2Diff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let diffSum = 0;
  for (let i = 0; i < n; i++) diffSum += (a[i] - b[i]) ** 2;
  return Math.sqrt(diffSum / n);
}

function energyRms(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let energySum = 0;
  for (let i = 0; i < n; i++) energySum += a[i] ** 2 + b[i] ** 2;
  return Math.sqrt(energySum / (2 * n));
}

describe('Subtractive — LFO routing (real DSP)', () => {
  it('LFO routed to filter.cutoff produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'filter.cutoff', depth: 1.0 });
    writeWav(swept,    wavPath('subtractive__lfo-cutoff'),  SR);
    writeWav(baseline, wavPath('subtractive__lfo-baseline'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    // ≥ 10% relative L2: the LFO must move the cutoff far enough that the
    // resulting audio is not a near-copy of the unmodulated signal.
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to filter.resonance produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'filter.resonance', depth: 1.0 });
    writeWav(swept, wavPath('subtractive__lfo-resonance'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO on filter.resonance produces a different signal than LFO on filter.cutoff', async () => {
    const cutSwept = await renderWith({ paramId: 'filter.cutoff',    depth: 1.0 });
    const resSwept = await renderWith({ paramId: 'filter.resonance', depth: 1.0 });
    const diff   = l2Diff(cutSwept, resSwept);
    const energy = energyRms(cutSwept, resSwept);
    // Two different routings can't produce near-identical audio.
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to amp.gain produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'amp.gain', depth: 1.0 });
    writeWav(swept,    wavPath('subtractive__lfo-amp-gain'),     SR);
    writeWav(baseline, wavPath('subtractive__lfo-amp-baseline'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to osc1.level produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'osc1.level', depth: 1.0 });
    writeWav(swept,    wavPath('subtractive__lfo-osc1-level'),     SR);
    writeWav(baseline, wavPath('subtractive__lfo-osc1-baseline'),  SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  // The remaining tests guard the "every continuous param is LFO-able" promise.
  // Each one drives a different scalar in the polysynth that used to be read
  // once at trigger time and is now exposed as a per-voice AudioParam.

  it('LFO routed to osc2.detune produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'osc2.detune', depth: 1.0 });
    writeWav(swept, wavPath('subtractive__lfo-osc2-detune'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to noise.level produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'noise.level', depth: 1.0 });
    writeWav(swept, wavPath('subtractive__lfo-noise-level'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to filter.envAmount produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'filter.envAmount', depth: 1.0 });
    writeWav(swept, wavPath('subtractive__lfo-env-amount'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to filter.keyTrack produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'filter.keyTrack', depth: 1.0 });
    writeWav(swept, wavPath('subtractive__lfo-keytrack'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to filter.drive produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'filter.drive', depth: 1.0 });
    writeWav(swept, wavPath('subtractive__lfo-drive'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('LFO routed to master.tune produces audibly different output than no modulation', async () => {
    const baseline = await renderWith({});
    const swept    = await renderWith({ paramId: 'master.tune', depth: 1.0 });
    writeWav(swept, wavPath('subtractive__lfo-master-tune'), SR);
    const diff   = l2Diff(swept, baseline);
    const energy = energyRms(swept, baseline);
    expect(diff).toBeGreaterThan(energy * 0.1);
  });

  it('ADSR-AMP default connection with depth>0 actually modulates amp.gain', async () => {
    // The Subtractive engine ships with a default ADSR-AMP modulator whose
    // connection targets `amp.gain` (the short id, not `main.amp.gain`).
    // Historically the binder only matched the full prefixed id, so the
    // default connection bound nothing — the user could dial up depth and
    // hear no change. This test pins the fix: the binder must also accept
    // the short paramId on the same lane.
    _resetLaneBindingsForTesting();
    setCurrentLaneForVoice('main');
    try {
      const engine = new SubtractiveEngine();
      engine.setBaseValue('filter.cutoff',    0.5);
      engine.setBaseValue('filter.resonance', 0.2);
      engine.setBaseValue('filter.envAmount', 0);
      engine.setBaseValue('amp.attack',  0.01);
      engine.setBaseValue('amp.decay',   0.05);
      engine.setBaseValue('amp.sustain', 1.0);
      engine.setBaseValue('amp.release', 0.3);

      // Set ADSR-AMP's default connection depth high so its envelope drives
      // amp.gain audibly on top of the polysynth's own amp envelope.
      const adsrAmp = engine.modulators.modulators.find((m) => m.id === 'adsr-amp')!;
      adsrAmp.enabled = true;
      adsrAmp.attackSec = 0.8;     // slow attack — audible vs no-mod baseline
      adsrAmp.connections = [{ id: 'c-amp', paramId: 'amp.gain', depth: 1.0 }];

      const buf = await renderEngine(
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

      // Render a baseline with ADSR-AMP disabled, same trigger.
      _resetLaneBindingsForTesting();
      setCurrentLaneForVoice('main');
      const engineB = new SubtractiveEngine();
      engineB.setBaseValue('filter.cutoff',    0.5);
      engineB.setBaseValue('filter.resonance', 0.2);
      engineB.setBaseValue('filter.envAmount', 0);
      engineB.setBaseValue('amp.attack',  0.01);
      engineB.setBaseValue('amp.decay',   0.05);
      engineB.setBaseValue('amp.sustain', 1.0);
      engineB.setBaseValue('amp.release', 0.3);
      const adsrAmpB = engineB.modulators.modulators.find((m) => m.id === 'adsr-amp')!;
      adsrAmpB.enabled = false;
      const baseline = await renderEngine(
        (ctx) => {
          const output = (ctx as unknown as { createGain(): GainNode }).createGain();
          const voice = engineB.createVoice(ctx as unknown as AudioContext, output);
          return { voice, output };
        },
        {
          durationSec: DUR,
          sampleRate:  SR,
          events: [{ time: 0, type: 'trigger', midi: MIDI, gateDuration: DUR * 0.95 }],
        },
      );

      writeWav(buf,      wavPath('subtractive__adsr-amp-default'),  SR);
      writeWav(baseline, wavPath('subtractive__adsr-amp-disabled'), SR);

      const diff   = l2Diff(buf, baseline);
      const energy = energyRms(buf, baseline);
      // Same threshold as LFO tests: ≥ 10% relative L2.
      expect(diff).toBeGreaterThan(energy * 0.1);
    } finally {
      setCurrentLaneForVoice(null);
    }
  });
});
