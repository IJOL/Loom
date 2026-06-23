import { describe, it, expect } from 'vitest';
import { ModulationRuntime } from './modulation-runtime';

const SR = 48000;
describe('ModulationRuntime (shared LFO)', () => {
  it('a disabled LFO contributes zero', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: false, rateHz: 4, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    expect(r.offsetFor('filterCutoff', 0.1)).toBe(0);
  });

  it('an enabled sine LFO oscillates the target offset between roughly ±depth', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: true, rateHz: 2, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    let min = 1, max = -1;
    for (let i = 0; i < SR; i++) { const v = r.offsetFor('filterCutoff', i / SR); min = Math.min(min, v); max = Math.max(max, v); }
    expect(max).toBeGreaterThan(0.3);
    expect(min).toBeLessThan(-0.3);
  });

  it('only modulates the connected param', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: true, rateHz: 2, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    for (let i = 0; i < 100; i++) r.offsetFor('filterCutoff', i / SR);
    expect(r.offsetFor('filterResonance', 0.05)).toBe(0);
  });

  it('an adsr-kind mod contributes zero (Phase 1 scope: shared LFOs only)', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'a', kind: 'adsr', enabled: true, rateHz: 4, waveform: 'sine', depthByParam: { filterCutoff: 0.9 } }]);
    let any = 0;
    for (let i = 0; i < 1000; i++) any += Math.abs(r.offsetFor('filterCutoff', i / SR));
    expect(any).toBe(0);
  });

  it('sums depth across two LFOs on the same param', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([
      { id: 'a', kind: 'lfo', enabled: true, rateHz: 1, waveform: 'square', depthByParam: { osc1Level: 0.2 } },
      { id: 'b', kind: 'lfo', enabled: true, rateHz: 1, waveform: 'square', depthByParam: { osc1Level: 0.3 } },
    ]);
    // both square waves are +1 in the first half-cycle → 0.2 + 0.3 = 0.5
    expect(r.offsetFor('osc1Level', 0.1)).toBeCloseTo(0.5, 6);
  });
});
