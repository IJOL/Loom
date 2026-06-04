import { describe, it, expect, beforeEach } from 'vitest';
import { loadDrumKits, getDrumKits, __resetDrumKitsCache, validateDrumKit } from './drum-kits-loader';

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('drum-kits-loader', () => {
  beforeEach(() => __resetDrumKitsCache());

  it('validates a synth entry and a sample entry', () => {
    expect(validateDrumKit({ name: 'A', group: 'Synth', kind: 'synth', kitId: '909' })).toBe(true);
    expect(validateDrumKit({ name: 'B', group: 'Samples', kind: 'sample', drumkitId: 'tr808' })).toBe(true);
  });

  it('rejects malformed entries', () => {
    expect(validateDrumKit({ name: 'A', group: 'Synth', kind: 'synth' })).toBe(false); // no kitId
    expect(validateDrumKit({ name: 'B', group: 'Samples', kind: 'sample' })).toBe(false); // no drumkitId
    expect(validateDrumKit({ name: '', group: 'Synth', kind: 'synth', kitId: '909' })).toBe(false); // empty name
    expect(validateDrumKit({ name: 'C', group: 'Synth', kind: 'bogus', kitId: '909' })).toBe(false); // bad kind
  });

  it('loads + caches, dropping malformed entries', async () => {
    const body = { presets: [
      { name: 'TR-909', group: 'Synth', kind: 'synth', kitId: '909' },
      { name: 'bad', group: 'Synth', kind: 'synth' },
      { name: 'TR-808 (samples)', group: 'Samples', kind: 'sample', drumkitId: 'tr808' },
    ] };
    const out = await loadDrumKits(fakeFetch(body));
    expect(out.map((p) => p.name)).toEqual(['TR-909', 'TR-808 (samples)']);
    expect(getDrumKits().map((p) => p.name)).toEqual(['TR-909', 'TR-808 (samples)']);
  });

  it('getDrumKits is empty before load', () => {
    expect(getDrumKits()).toEqual([]);
  });
});
