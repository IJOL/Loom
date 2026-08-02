import { describe, it, expect } from 'vitest';
import { ModulationRuntime, type ModLite } from './modulation-runtime';
import { buildParamIndex } from './param-index';
import { registerModulatorKernel } from './modulator-kernels';
// Side-effect import: registers the 'lfo' kernel so the tests below that use
// kind: 'lfo' exercise the real registry lookup, not a hardcoded comparison.
import './modulators/lfo-kernel';

// A kernel registered under a kind that is neither 'lfo' nor 'adsr', purely
// to prove the runtime does a REAL registry lookup by kind. Its signal is a
// constant, not a wave — the point is the lookup, not the maths.
registerModulatorKernel({ id: 'echo-test-kernel', valueAt: () => 0.7 });

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

  it('POLARITY: a unipolar LFO only pushes one way (0..depth, never negative)', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: true, bipolar: false, rateHz: 2, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    let min = 1, max = -1;
    for (let i = 0; i < SR; i++) { const v = r.offsetFor('filterCutoff', i / SR); min = Math.min(min, v); max = Math.max(max, v); }
    expect(min).toBeGreaterThanOrEqual(0);          // never goes negative
    expect(max).toBeGreaterThan(0.3);               // reaches ~depth
    expect(max).toBeLessThanOrEqual(0.5 + 1e-9);    // capped at depth
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

// activeOffsets() is the telemetry the worklet posts to the UI so the knob rings
// reflect the REAL modulation (not a main-thread re-computation). It must agree
// with offsetFor() for every modulated param and omit the rest.
describe('ModulationRuntime.activeOffsets (UI telemetry)', () => {
  it('reports the live offset for every modulated param, matching offsetFor', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{
      id: 'l', kind: 'lfo', enabled: true, rateHz: 2, waveform: 'sine',
      depthByParam: { filterCutoff: 0.5, osc1Level: 0.3 },
    }]);
    const t = 0.1;
    const off = r.activeOffsets(t);
    expect(off.filterCutoff).toBeCloseTo(r.offsetFor('filterCutoff', t), 9);
    expect(off.osc1Level).toBeCloseTo(r.offsetFor('osc1Level', t), 9);
    expect(Object.keys(off).sort()).toEqual(['filterCutoff', 'osc1Level']);
  });

  it('is empty when the only LFO is disabled (nothing modulating)', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: false, rateHz: 2, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    expect(r.activeOffsets(0.1)).toEqual({});
  });

  it('sums two LFOs on the same param (matches offsetFor)', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([
      { id: 'a', kind: 'lfo', enabled: true, rateHz: 1, waveform: 'square', depthByParam: { osc1Level: 0.2 } },
      { id: 'b', kind: 'lfo', enabled: true, rateHz: 1, waveform: 'square', depthByParam: { osc1Level: 0.3 } },
    ]);
    expect(r.activeOffsets(0.1).osc1Level).toBeCloseTo(0.5, 6);
  });
});

// The runtime used to decide by comparing `m.kind !== 'lfo'`, which happened to
// also exclude any unknown kind — so a naive "unknown kind contributes zero"
// test would pass for the WRONG reason (it never proved a real lookup runs).
// These two tests together are the actual proof: a kind that IS registered but
// is NOT 'lfo' must contribute (only possible via a genuine registry lookup),
// while a kind that is NOT registered must not.
describe('ModulationRuntime (kernel registry — real lookup, not a hardcoded kind check)', () => {
  it('a kernel registered under a kind other than lfo/adsr DOES contribute', () => {
    const rt = new ModulationRuntime(44100);
    rt.setMods([{
      id: 'e1', kind: 'echo-test-kernel', enabled: true, rateHz: 4,
      waveform: 'sine', depthByParam: { 'filter.cutoff': 0.4 },
    } as never]);
    // echo-test-kernel's valueAt is a constant 0.7, so the offset is 0.7 × 0.4.
    // The old `m.kind !== 'lfo'` check would have skipped this entirely (0).
    expect(rt.offsetFor('filter.cutoff' as never, 0.25)).toBeCloseTo(0.28, 9);
  });

  it('ignores a modulator whose kind has no kernel instead of treating it as an LFO', () => {
    const rt = new ModulationRuntime(44100);
    rt.setMods([{
      id: 'x1', kind: 'no-such-kernel', enabled: true, rateHz: 4,
      waveform: 'sine', depthByParam: { 'filter.cutoff': 1 },
    } as never]);
    // A kind with no kernel contributes nothing. The old code compared against
    // 'lfo' and would have summed this one's sine.
    expect(rt.offsetFor('filter.cutoff' as never, 0.25)).toBe(0);
  });
});

// getAdsrMods used to decide by comparing `m.kind === 'adsr'`. It now asks the
// DRIVER (ModLite.driver, mirroring ModulatorComponent.driver) instead — same
// trick as the kernel-registry tests above: naming something 'adsr' proves
// nothing on its own, so both directions are tested.
describe('ModulationRuntime.getAdsrMods (driver, not id)', () => {
  it("a mod with driver:'gate' is returned, whatever its kind is named", () => {
    const rt = new ModulationRuntime(44100);
    rt.setMods([{
      id: 'g1', kind: 'totally-not-called-adsr', driver: 'gate', enabled: true,
      rateHz: 0, waveform: 'sine', depthByParam: {},
    } as never]);
    expect(rt.getAdsrMods().map((m) => m.id)).toEqual(['g1']);
  });

  it("a mod literally kind:'adsr' but WITHOUT driver:'gate' is NOT returned", () => {
    const rt = new ModulationRuntime(44100);
    rt.setMods([{
      id: 'a1', kind: 'adsr', enabled: true,
      rateHz: 0, waveform: 'sine', depthByParam: {},
    } as never]);
    // No `driver` field at all (a hand-built ModLite that skipped toModLite,
    // exactly like this file's other literals) — the old `kind === 'adsr'`
    // check would have returned this one; asking the driver correctly does not.
    expect(rt.getAdsrMods()).toEqual([]);
  });

  it('a disabled gate mod is excluded', () => {
    const rt = new ModulationRuntime(44100);
    rt.setMods([{
      id: 'g1', kind: 'x', driver: 'gate', enabled: false,
      rateHz: 0, waveform: 'sine', depthByParam: {},
    } as never]);
    expect(rt.getAdsrMods()).toEqual([]);
  });
});

// ── Slot-addressed offsets ─────────────────────────────────────────────────
// The same sums, indexed instead of named. The resolution from a target name to
// a slot happens ONCE, when the modulator set or the numbering changes — doing
// it per sample would cost exactly what reading params by name used to.
describe('offsetsIntoSlots', () => {
  const IX = buildParamIndex(['filter.cutoff', 'osc1.level']);
  const lfo = (depthByParam: Record<string, number>, over: Partial<ModLite> = {}): ModLite => ({
    id: 'l', kind: 'echo-test-kernel', enabled: true, rateHz: 0, waveform: 'sine',
    depthByParam, ...over,
  });

  it('writes each target at its slot, and leaves untargeted slots at zero', () => {
    const r = new ModulationRuntime(SR);
    r.bindIndex(IX);
    r.setMods([lfo({ 'filter.cutoff': 0.5 })]);
    const out = new Float64Array(IX.length);
    r.offsetsIntoSlots(out, 0);
    expect(out[IX.slot['filter.cutoff']]).toBeCloseTo(0.35, 6);   // 0.7 × 0.5
    expect(out[IX.slot['osc1.level']]).toBe(0);
  });

  it('agrees with the name-keyed fill, sum for sum', () => {
    const r = new ModulationRuntime(SR);
    r.bindIndex(IX);
    r.setMods([lfo({ 'filter.cutoff': 0.5 }), lfo({ 'filter.cutoff': 0.2, 'osc1.level': -0.4 }, { id: 'l2' })]);
    const byName: Record<string, number> = {};
    r.offsetsInto(byName, 0);
    const bySlot = new Float64Array(IX.length);
    r.offsetsIntoSlots(bySlot, 0);
    for (const id of ['filter.cutoff', 'osc1.level']) {
      expect(bySlot[IX.slot[id]]).toBeCloseTo(byName[id], 12);
    }
  });

  it('clears the previous sample before adding — a pooled array is reused', () => {
    const r = new ModulationRuntime(SR);
    r.bindIndex(IX);
    r.setMods([lfo({ 'filter.cutoff': 0.5 })]);
    const out = new Float64Array(IX.length);
    out.fill(99);
    r.offsetsIntoSlots(out, 0);
    expect(out[IX.slot['osc1.level']]).toBe(0);
  });

  it('binding the index AFTER the mods still resolves them (order must not matter)', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([lfo({ 'filter.cutoff': 0.5 })]);
    const out = new Float64Array(IX.length);
    r.offsetsIntoSlots(out, 0);
    expect(out[IX.slot['filter.cutoff']], 'no index bound yet ⇒ nothing resolved').toBe(0);
    r.bindIndex(IX);
    r.offsetsIntoSlots(out, 0);
    expect(out[IX.slot['filter.cutoff']]).toBeCloseTo(0.35, 6);
  });

  it('a target the lane does not declare is inert, not a crash or a stray write', () => {
    const r = new ModulationRuntime(SR);
    r.bindIndex(IX);
    r.setMods([lfo({ 'no.such.param': 1, 'filter.cutoff': 0.5 })]);
    const out = new Float64Array(IX.length);
    r.offsetsIntoSlots(out, 0);
    expect(out[IX.slot['filter.cutoff']]).toBeCloseTo(0.35, 6);
    expect(out.every((v, i) => i === IX.slot['filter.cutoff'] || v === 0)).toBe(true);
  });
});
