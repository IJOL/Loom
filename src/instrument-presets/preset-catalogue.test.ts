// One catalogue, so two surfaces cannot offer different things for one lane.
//
// The bug this replaces was not a wrong filter: WEAVE offered a sampler lane a
// third of what the instrument page did, because the ids for the rest were
// understood by exactly one module. A short list nobody chose.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { presetsFor } from './preset-catalogue';
import { __resetInstrumentIndexCache, loadInstrumentIndex } from '../samples/instrument-loader';
import { seedEnginePresets, __resetPresetCache } from '../presets/preset-loader';
import {
  registerEngineCapabilities, unregisterEngineCapabilities,
} from '../plugins/capabilities';

const INDEX = [
  { id: 'glass', name: 'Glass Keys', family: 'melodic' as const },
  { id: 'amen', name: 'Amen', family: 'loop' as const },
  { id: 'bell', name: 'Bell', family: 'melodic' as const },
];

/** Enough of a fetch for the index loader. */
const fakeFetch = (async () => ({
  ok: true, json: async () => INDEX,
})) as unknown as typeof fetch;

beforeEach(async () => {
  __resetInstrumentIndexCache();
  await loadInstrumentIndex(fakeFetch);
});

afterEach(() => { __resetInstrumentIndexCache(); __resetPresetCache(); });

describe('a sampler lane', () => {
  it('is offered its bundled instruments, not just the inline presets', () => {
    // The whole point. WEAVE could not offer these because it could not apply
    // them; the catalogue answers for both surfaces, so neither can be short.
    const names = presetsFor('sampler').map((c) => c.name);
    expect(names).toContain('Glass Keys');
    expect(names).toContain('Bell');
  });

  it('puts melodic material in ONE group, whichever file it came from', () => {
    // `presets/sampler.json` carries its zones inline and the index is fetched
    // by id. That is our storage layout, not something a player should have to
    // know, so it is one shelf.
    const groups = new Set(presetsFor('sampler').map((c) => c.group));
    expect(groups).toEqual(new Set(['Melodic', 'Loops']));
  });

  it('keeps loops apart — a chopped amen is not an instrument', () => {
    const loops = presetsFor('sampler').filter((c) => c.group === 'Loops');
    expect(loops.map((c) => c.name)).toEqual(['Amen']);
  });

  it('offers no drumkits: they are the drum machine\'s shelf', () => {
    expect(presetsFor('sampler').some((c) => c.id.includes('drumkit'))).toBe(false);
  });

  it('sorts each group by name, so the list reads as sorted', () => {
    const melodic = presetsFor('sampler').filter((c) => c.group === 'Melodic');
    expect(melodic.map((c) => c.name)).toEqual([...melodic.map((c) => c.name)].sort());
  });

  it('answers synchronously before the index resolves, and says when there is more', async () => {
    // Every caller is a dropdown that has to render NOW. An empty list for no
    // visible reason is worse than one that fills in a moment later.
    __resetInstrumentIndexCache();
    let told = false;
    const first = presetsFor('sampler', () => { told = true; });
    expect(Array.isArray(first)).toBe(true);
    await loadInstrumentIndex(fakeFetch);
    expect(told).toBe(true);
  });
});

describe('a melodic engine', () => {
  it('is offered what it ships, under Factory', () => {
    seedEnginePresets('fm', [{ name: 'Bright Bell', params: {} }] as never);
    const out = presetsFor('fm');
    expect(out).toContainEqual({ id: 'engine:Bright Bell', name: 'Bright Bell', group: 'Factory' });
  });
});

describe('an engine nobody registered', () => {
  it('gets an empty list rather than a guess', () => {
    // A picker with nothing in it is honest. One full of another engine's
    // presets is not — and would apply values that mean nothing here.
    expect(presetsFor('not-an-engine')).toEqual([]);
  });
});

describe('a kit engine', () => {
  it('reads the kit shelf, not the engine preset cache', () => {
    // Asking the preset cache returned the SYNTH kits alone, which is a third of
    // what a drum lane can play.
    registerEngineCapabilities('drums-machine', {
      harmonic: false, clipContent: 'notes', shortLabel: 'DR', outputTrim: 1, presetKind: 'kits',
    } as never);
    try {
      expect(presetsFor('drums-machine').every((c) => c.id.startsWith('engine:'))).toBe(true);
    } finally {
      unregisterEngineCapabilities('drums-machine');
    }
  });
});
