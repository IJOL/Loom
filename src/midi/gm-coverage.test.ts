import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const TONAL_ENGINES = ['tb303', 'fm', 'wavetable', 'karplus', 'subtractive', 'westcoast'];
const DRUM_ENGINES  = ['drums', 'drums-machine']; // accept whichever filename exists

function loadPresets(engineId: string): { name: string; gm: number[] }[] {
  const path = resolve('public/presets', `${engineId}.json`);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text).presets ?? [];
}

describe('GM coverage', () => {
  it('every GM program 0-127 has at least one tonal preset (excluding drums)', () => {
    const covered = new Set<number>();
    for (const eng of TONAL_ENGINES) {
      for (const p of loadPresets(eng)) for (const g of p.gm ?? []) covered.add(g);
    }
    const missing: number[] = [];
    for (let g = 0; g < 128; g++) if (!covered.has(g)) missing.push(g);
    expect(missing, `Uncovered GM programs: ${missing.join(',')}`).toEqual([]);
  });

  it('every canonical GM drum kit program has a drums preset', () => {
    const covered = new Set<number>();
    for (const eng of DRUM_ENGINES) {
      for (const p of loadPresets(eng)) for (const g of p.gm ?? []) covered.add(g);
    }
    for (const kit of [0, 8, 16, 24, 25, 33, 41, 49]) {
      expect(covered.has(kit), `Missing drum kit GM ${kit}`).toBe(true);
    }
  });
});
