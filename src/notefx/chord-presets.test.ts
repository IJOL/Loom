// src/notefx/chord-presets.test.ts
import { describe, it, expect } from 'vitest';
import { CHORD_FX_PRESETS, applyChordFxPreset } from './chord-presets';
import { ChordProcessor, CHORD_PROCESSOR_DEFAULTS, type ChordProcessorParams } from './chord-processor';

describe('chord FX presets', () => {
  it('ships a real bank: at least 8 presets, unique ids, human names', () => {
    expect(CHORD_FX_PRESETS.length).toBeGreaterThanOrEqual(8);
    const ids = CHORD_FX_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CHORD_FX_PRESETS) expect(p.name.length).toBeGreaterThan(0);
  });

  it('every preset only writes params the processor declares, with matching types', () => {
    const defaults = CHORD_PROCESSOR_DEFAULTS as unknown as Record<string, unknown>;
    for (const p of CHORD_FX_PRESETS) {
      for (const [k, v] of Object.entries(p.params)) {
        expect(defaults, `${p.id}.${k}`).toHaveProperty(k);
        expect(typeof v, `${p.id}.${k}`).toBe(typeof defaults[k]);
      }
    }
  });

  it('applying a preset resets to defaults first — no leftover toggles; unknown ids change nothing', () => {
    const bag = { ...CHORD_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string | boolean>;
    bag.alter = true; // a leftover the preset does not name must not survive
    applyChordFxPreset(bag, CHORD_FX_PRESETS[0].id);
    for (const [k, v] of Object.entries(CHORD_FX_PRESETS[0].params)) expect(bag[k]).toBe(v);
    if (!('alter' in CHORD_FX_PRESETS[0].params)) expect(bag.alter).toBe(false);
    const before = { ...bag };
    applyChordFxPreset(bag, 'no-such-preset');
    expect(bag).toEqual(before);
  });

  it('every preset actually sounds: at least one note out for one note in', () => {
    for (const p of CHORD_FX_PRESETS) {
      const bag = { ...CHORD_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string | boolean>;
      applyChordFxPreset(bag, p.id);
      const proc = new ChordProcessor(bag as unknown as ChordProcessorParams);
      const out = proc.process(
        [{ note: 60, time: 0, gate: 1, accent: false }],
        { bpm: 120, key: 0, scale: 'major' },
      );
      expect(out.length, p.id).toBeGreaterThanOrEqual(1);
    }
  });
});
