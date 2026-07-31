import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const TONAL_ENGINES = ['tb303', 'fm', 'wavetable', 'karplus', 'subtractive', 'westcoast'];
const DRUM_ENGINES  = ['drums', 'drums-machine']; // accept whichever filename exists

/** A built-in engine keeps its presets in public/presets/<id>.json; a PLUGIN
 *  ships them inside its own directory. Both are real sources of GM coverage —
 *  the plucked-string plugin is what covers the guitar programs (24-31), so
 *  looking in only one place would silently open a hole in the claim below. */
function loadPresets(engineId: string): { name: string; gm: number[] }[] {
  for (const path of [
    resolve('public/presets', `${engineId}.json`),
    resolve('plugins', engineId, 'presets.json'),
  ]) {
    if (!existsSync(path)) continue;
    return JSON.parse(readFileSync(path, 'utf8')).presets ?? [];
  }
  return [];
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
