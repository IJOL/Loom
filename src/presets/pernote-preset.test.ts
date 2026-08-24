// The Per-Note sound ships as a PRESET rather than as a ninth engine, because
// the engine it needs already exists: Subtractive has pulse oscillators with
// PW, ladder filter models and both envelopes. What did not exist was a
// modulator that varies per note, so the preset is where the two meet.
//
// A preset carries its own modulators, and a plugin modulator's settings ride
// in a generic `params` bag. The loader validates modulators only shallowly, so
// this checks the bag actually survives the trip rather than assuming it.
import { describe, it, expect } from 'vitest';
import { validatePresetEntry } from './preset-loader';
import presets from '../../plugins/subtractive/presets.json';

type Mod = {
  kind: string; enabled?: boolean; scope?: string;
  params?: Record<string, number>;
  connections?: { paramId: string; depth: number }[];
};
type Preset = { name: string; params: Record<string, number>; modulators?: Mod[] };

const all = (Array.isArray(presets)
  ? presets
  : (presets as unknown as { presets: Preset[] }).presets) as unknown as Preset[];
const entry = () => all.find((p) => p.name === 'PLUCK Per-Note Pulse')!;

describe('the Per-Note preset', () => {
  it('ships, and passes the real loader validation', () => {
    expect(entry(), 'PLUCK Per-Note Pulse is not in subtractive presets.json').toBeDefined();
    expect(validatePresetEntry(entry())).toBe(true);
  });

  it('carries the modulator with its settings intact', () => {
    const pn = entry().modulators?.find((m) => m.kind === 'pernote');
    expect(pn, 'the preset lost its per-note modulator').toBeDefined();
    // The bag a plugin kernel reads. Without it the modulator loads enabled and
    // connected and falls back to defaults — quietly not the sound that shipped.
    expect(pn!.params?.pattern).toBeGreaterThan(0);
    expect(pn!.params).toHaveProperty('skew');
    expect(pn!.params).toHaveProperty('bipolar');
  });

  it('uses an irrational pattern, so the sequence never comes back', () => {
    const pattern = entry().modulators!.find((m) => m.kind === 'pernote')!.params!.pattern;
    // A short decimal is a rational and cycles: 0.618 is 309/500 and returns at
    // note 500. Anything shipped here must carry enough digits not to.
    expect(String(pattern).replace('0.', '').length).toBeGreaterThan(10);
  });

  it('runs per voice, or every note in a chord would share one value', () => {
    expect(entry().modulators!.find((m) => m.kind === 'pernote')!.scope).toBe('per-voice');
  });

  it('drives targets the engine actually declares', () => {
    const declared = new Set(
      (require('../../plugins/subtractive/plugin.json') as {
        components: { params: { id: string }[] }[];
      }).components.flatMap((c) => c.params.map((p) => p.id)),
    );
    for (const c of entry().modulators!.find((m) => m.kind === 'pernote')!.connections!) {
      expect(declared.has(c.paramId), `${c.paramId} is not a subtractive param`).toBe(true);
      expect(c.depth).toBeGreaterThan(0);
    }
  });
});
