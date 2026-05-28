// src/session/session-knobs-per-lane.dsp.test.ts
// Confirms that creating two SubtractiveEngine instances and setting their
// filter.cutoff to different values yields audibly different output — pins
// the contract that per-lane engine state is isolated.

import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from '../engines/subtractive';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100, DUR = 0.4, MIDI = 48;

async function renderLane(cutoff: number): Promise<Float32Array> {
  const engine = new SubtractiveEngine();
  engine.setBaseValue('filter.cutoff', cutoff);
  return renderEngine(
    (ctx) => {
      const out = ctx.createGain();
      const voice = engine.createVoice(ctx as unknown as AudioContext, out as unknown as AudioNode);
      return { voice, output: out };
    },
    {
      durationSec: DUR,
      sampleRate: SR,
      events: [{ time: 0, type: 'trigger', midi: MIDI, gateDuration: DUR * 0.9 }],
    },
  );
}

describe('per-lane SubtractiveEngine instances are isolated', () => {
  it('two engine instances with different cutoff produce different spectra', async () => {
    const dark   = await renderLane(0.15);
    const bright = await renderLane(0.85);
    const cDark   = spectralCentroid(dark, SR);
    const cBright = spectralCentroid(bright, SR);
    // The bright instance MUST have a measurably higher centroid.
    expect(cBright).toBeGreaterThan(cDark * 1.5);
  });
});
