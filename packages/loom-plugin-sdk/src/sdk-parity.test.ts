import { describe, it, expect } from 'vitest';
import { velGain01, midiToFreq, param, Adsr, ModEnvHost } from './index';

describe('@loom/plugin-sdk', () => {
  it('exports the velocity curve the renderers were tuned against', () => {
    // Relative: full velocity must sit above the 0.3 floor by the curve's own
    // ratio (0.3 + 1.1) / 0.3, not an absolute number.
    expect(velGain01(1, false) / velGain01(0, false)).toBeCloseTo(1.4 / 0.3, 6);
    expect(velGain01(1, true)).toBeGreaterThan(velGain01(1, false));
  });

  it('maps MIDI to frequency with A4 = 69 as the anchor octave', () => {
    expect(midiToFreq(81) / midiToFreq(69)).toBeCloseTo(2, 9);
  });

  it('reads a param bag with a fallback', () => {
    expect(param({ 'amp.level': 0.4 }, 'amp.level', 1)).toBe(0.4);
    expect(param({}, 'amp.level', 1)).toBe(1);
  });

  it('runs an ADSR that rises under gate and falls after release', () => {
    const a = new Adsr();
    a.update(0, 1, 0.1, 0.1, 0.5, 0.1);
    const rising = a.update(0.05, 1, 0.1, 0.1, 0.5, 0.1);
    const held = a.update(0.3, 1, 0.1, 0.1, 0.5, 0.1);
    const released = a.update(0.5, 0, 0.1, 0.1, 0.5, 0.1);
    expect(rising).toBeGreaterThan(0);
    expect(released).toBeLessThan(held);
  });

  it('folds ADSR offsets on top of the shared-LFO offsets', () => {
    const h = new ModEnvHost();
    expect(h.active).toBe(false);
    h.setModEnvelopes([{ attackSec: 0.01, decaySec: 0.1, sustain: 1, releaseSec: 0.1, depthByParam: { 'amp.level': 0.5 } }]);
    h.combine(0, 1);
    const out = h.combine(0.5, 1, { 'amp.level': 0.1 });
    expect(out['amp.level']).toBeGreaterThan(0.1);
  });
});
