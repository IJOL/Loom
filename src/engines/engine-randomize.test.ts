import { describe, it, expect } from 'vitest';
import { randomizeEngineParams } from './engine-randomize';
import type { EngineParamSpec } from './engine-params';

const SPECS: EngineParamSpec[] = [
  { id: 'filter.cutoff',   label: 'CUT',  kind: 'continuous', min: 0,   max: 1,  default: 0.5 },
  { id: 'filter.resonance', label: 'RES', kind: 'continuous', min: 0,   max: 20, default: 5 },
  { id: 'amp.attack',      label: 'ATK',  kind: 'continuous', min: 0.001, max: 2, default: 0.01 },
  { id: 'osc1.wave',       label: 'WAVE', kind: 'discrete',   min: 0,   max: 3,  default: 0,
    options: [{ value: 'saw', label: 'Saw' }, { value: 'sq', label: 'Sq' }, { value: 'tri', label: 'Tri' }, { value: 'sin', label: 'Sin' }] },
  // Excluded on purpose — see the assertions below.
  { id: 'master.tune',     label: 'TUNE', kind: 'continuous', min: -12, max: 12, default: 0 },
  { id: 'poly.voices',     label: 'VOX',  kind: 'continuous', min: 1,   max: 16, default: 8 },
  { id: 'bus.level',       label: 'LVL',  kind: 'continuous', min: 0,   max: 1.5, default: 0.8 },
  { id: 'bus.pan',         label: 'PAN',  kind: 'continuous', min: -1,  max: 1,  default: 0 },
];

function fakeEngine(specs: EngineParamSpec[] = SPECS) {
  const values: Record<string, number> = {};
  for (const s of specs) values[s.id] = s.default;
  return {
    params: specs,
    getBaseValue: (id: string) => values[id] ?? 0,
    setBaseValue: (id: string, v: number) => { values[id] = v; },
    values,
  };
}

/** Deterministic pseudo-random in [0,1) — no Math.random in tests. */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

describe('randomizeEngineParams', () => {
  it('user: every randomized value stays inside its declared range', () => {
    const eng = fakeEngine();
    randomizeEngineParams(eng, { rng: seededRng(7) });
    for (const s of SPECS) {
      const v = eng.getBaseValue(s.id);
      expect(v).toBeGreaterThanOrEqual(s.min);
      expect(v).toBeLessThanOrEqual(s.max);
    }
  });

  it('user: the sound actually changes — several params move', () => {
    const eng = fakeEngine();
    randomizeEngineParams(eng, { rng: seededRng(11) });
    const moved = ['filter.cutoff', 'filter.resonance', 'amp.attack']
      .filter((id) => eng.getBaseValue(id) !== SPECS.find((s) => s.id === id)!.default);
    expect(moved.length).toBeGreaterThanOrEqual(2);
  });

  it('the mixer strip is NOT touched — level/pan belong to the desk, not the sound', () => {
    const eng = fakeEngine();
    randomizeEngineParams(eng, { rng: seededRng(3) });
    expect(eng.getBaseValue('bus.level')).toBe(0.8);
    expect(eng.getBaseValue('bus.pan')).toBe(0);
  });

  it('tuning is NOT touched — a dice roll must not detune the lane against the others', () => {
    const eng = fakeEngine();
    randomizeEngineParams(eng, { rng: seededRng(5) });
    expect(eng.getBaseValue('master.tune')).toBe(0);
  });

  it('voice count is NOT touched — polyphony is not timbre', () => {
    const eng = fakeEngine();
    randomizeEngineParams(eng, { rng: seededRng(5) });
    expect(eng.getBaseValue('poly.voices')).toBe(8);
  });

  it('a discrete param lands on a whole, valid option index', () => {
    const eng = fakeEngine();
    for (let seed = 1; seed < 40; seed++) {
      randomizeEngineParams(eng, { rng: seededRng(seed) });
      const w = eng.getBaseValue('osc1.wave');
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(3);
    }
  });

  it('stays near the default rather than slamming the extremes', () => {
    // The old bass randomize hand-picked musical sub-ranges. Generic code can't
    // know them, so it biases toward the current default instead: over many
    // rolls the mean sits near the default and full-scale swings are rare.
    // Otherwise "🎲 Sound" mostly produces unusable noise.
    const rng = seededRng(23);
    let sum = 0, extremes = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const eng = fakeEngine();
      randomizeEngineParams(eng, { rng });
      const v = eng.getBaseValue('filter.cutoff');
      sum += v;
      if (v < 0.05 || v > 0.95) extremes++;
    }
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.08);   // centred on the default
    expect(extremes / N).toBeLessThan(0.1);               // extremes are the tail, not the norm
  });

  it('an engine with only excluded params is left untouched, not broken', () => {
    const eng = fakeEngine([
      { id: 'bus.level', label: 'LVL', kind: 'continuous', min: 0, max: 1.5, default: 0.8 },
    ]);
    expect(() => randomizeEngineParams(eng, { rng: seededRng(1) })).not.toThrow();
    expect(eng.getBaseValue('bus.level')).toBe(0.8);
  });
});
