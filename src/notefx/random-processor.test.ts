// src/notefx/random-processor.test.ts
import { describe, it, expect } from 'vitest';
import { RandomProcessor, RANDOM_PROCESSOR_DEFAULTS } from './random-processor';
import type { NoteFxEvent, NoteFxContext } from './notefx-types';

const ev = (note: number, time = 0, gate = 1): NoteFxEvent => ({ note, time, gate, accent: true });
const ctx = (seed = 123): NoteFxContext => ({ bpm: 120, seed, key: 9, scale: 'minor' });

describe('RandomProcessor', () => {
  it('is a passthrough when all chances are zero', () => {
    const p = new RandomProcessor(RANDOM_PROCESSOR_DEFAULTS);
    const input = [ev(60), ev(64), ev(67)];
    expect(p.process(input, ctx())).toEqual(input.map((e) => ({ ...e })));
  });

  it('drops notes according to dropChance with the same seed', () => {
    const p = new RandomProcessor({ ...RANDOM_PROCESSOR_DEFAULTS, dropChance: 0.5 });
    const input = Array.from({ length: 100 }, (_, i) => ev(60, i));
    const outA = p.process(input, ctx(1));
    const outB = p.process(input, ctx(1));
    const outC = p.process(input, ctx(2));
    expect(outA.length).toBe(outB.length);
    expect(outA.map((e) => e.time)).toEqual(outB.map((e) => e.time));
    expect(outC.length).not.toBe(outA.length); // almost certainly different
  });

  it('randomizes pitch within the configured range', () => {
    const p = new RandomProcessor({
      ...RANDOM_PROCESSOR_DEFAULTS,
      chance: 1,
      choices: 4,
      interval: 3,
      sign: 'bi',
      mode: 'random',
      scaleAware: false,
    });
    const out = p.process([ev(60)], ctx(42));
    expect(out.length).toBe(1);
    const delta = out[0].note - 60;
    const choices = [3, 6, 9, 12];
    expect(choices.includes(Math.abs(delta))).toBe(true);
  });

  it('snaps randomized pitch to the active scale when scaleAware is true', () => {
    const p = new RandomProcessor({
      ...RANDOM_PROCESSOR_DEFAULTS,
      chance: 1,
      choices: 12,
      interval: 1,
      sign: 'add',
      mode: 'random',
      scaleAware: true,
    });
    const out = p.process([ev(60)], { bpm: 120, seed: 7, key: 0, scale: 'major' });
    expect(out.length).toBe(1);
    // C major pitch classes
    expect([0, 2, 4, 5, 7, 9, 11].includes(out[0].note % 12)).toBe(true);
  });

  it('alt mode cycles through choices deterministically', () => {
    const p = new RandomProcessor({
      ...RANDOM_PROCESSOR_DEFAULTS,
      chance: 1,
      choices: 3,
      interval: 2,
      sign: 'add',
      mode: 'alt',
      scaleAware: false,
    });
    const out = p.process([ev(60), ev(60), ev(60), ev(60)], ctx(5));
    expect(out.map((e) => e.note)).toEqual([62, 64, 66, 62]);
  });

  it('randomizes velocity within the configured range', () => {
    const p = new RandomProcessor({ ...RANDOM_PROCESSOR_DEFAULTS, velChance: 1, velRandom: 0.5 });
    const out = p.process([ev(60)], ctx(9));
    expect(out[0].accent).toBe(out[0].velocity! >= 100);
    expect(out[0].velocity).toBeGreaterThanOrEqual(1);
    expect(out[0].velocity).toBeLessThanOrEqual(127);
  });

  it('randomizes gate duration within the configured range', () => {
    const p = new RandomProcessor({ ...RANDOM_PROCESSOR_DEFAULTS, durChance: 1, durRandom: 0.5 });
    const out = p.process([ev(60, 0, 1)], ctx(11));
    expect(out[0].gate).not.toBe(1);
    expect(out[0].gate).toBeGreaterThanOrEqual(0.01);
  });

  it('preserves note order and count when only pitch/velocity/duration change', () => {
    const p = new RandomProcessor({
      ...RANDOM_PROCESSOR_DEFAULTS,
      chance: 1,
      velChance: 1,
      durChance: 1,
      scaleAware: false,
    });
    const input = [ev(60, 0), ev(64, 0.5), ev(67, 1)];
    const out = p.process(input, ctx(13));
    expect(out.length).toBe(3);
    expect(out.map((e) => e.time)).toEqual([0, 0.5, 1]);
  });
});
