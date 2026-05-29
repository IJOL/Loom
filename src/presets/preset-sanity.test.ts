import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Engine ids whose JSON files exist in public/presets/. drums-machine instead
// of drums; poly was merged into subtractive.
const ENGINES = ['tb303', 'fm', 'wavetable', 'karplus', 'subtractive', 'drums-machine'];

interface Preset { name: string; gm?: number[]; params: unknown }

function loadPresets(engineId: string): Preset[] {
  const path = resolve('public/presets', `${engineId}.json`);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text).presets ?? [];
}

describe.each(ENGINES)('preset sanity: %s', (engineId) => {
  const presets = loadPresets(engineId);

  it('file exists and parses', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  it('has at least the minimum count', () => {
    const min = engineId === 'drums-machine' ? 8 : 20;
    expect(presets.length).toBeGreaterThanOrEqual(min);
  });

  it('all names are unique', () => {
    const names = presets.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all gm entries are integers in [0,128)', () => {
    for (const p of presets) {
      for (const g of p.gm ?? []) {
        expect(Number.isInteger(g)).toBe(true);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThan(128);
      }
    }
  });

  it('all presets have a params object', () => {
    for (const p of presets) {
      expect(typeof p.params).toBe('object');
      expect(p.params).not.toBeNull();
    }
  });
});
