// src/samples/instrument-loader.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  buildMelodicKeymap,
  listInstruments,
  fetchInstrumentManifest,
  type MelodicInstrumentManifest,
} from './instrument-loader';

const ZONES: MelodicInstrumentManifest['zones'] = [
  { file: 'sweep-pad/low.wav', rootNote: 48, loNote: 0, hiNote: 59 },
  { file: 'sweep-pad/high.wav', rootNote: 72, loNote: 60, hiNote: 127, gain: 0.8 },
];

describe('buildMelodicKeymap (pure)', () => {
  it('builds one entry per zone with root/lo/hi from the zone, ids aligned by index', () => {
    const km = buildMelodicKeymap(ZONES, ['a', 'b']);
    expect(km).toHaveLength(2);
    expect(km[0]).toEqual({ sampleId: 'a', rootNote: 48, loNote: 0, hiNote: 59 });
    // gain carried through only when present on the zone
    expect(km[1]).toEqual({ sampleId: 'b', rootNote: 72, loNote: 60, hiNote: 127, gain: 0.8 });
  });

  it('keeps sampleId order aligned to zones', () => {
    const km = buildMelodicKeymap(ZONES, ['x', 'y']);
    expect(km.map((e) => e.sampleId)).toEqual(['x', 'y']);
  });

  it('omits gain when the zone has none', () => {
    const km = buildMelodicKeymap([{ file: 'a.wav', rootNote: 60, loNote: 0, hiNote: 127 }], ['only']);
    expect(km[0]).toEqual({ sampleId: 'only', rootNote: 60, loNote: 0, hiNote: 127 });
    expect('gain' in km[0]).toBe(false);
  });

  it('throws when ids count does not match zones count', () => {
    expect(() => buildMelodicKeymap(ZONES, ['only-one'])).toThrow();
  });
});

describe('listInstruments / fetchInstrumentManifest', () => {
  it('reads the bundled index', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: 'sweep-pad', name: 'Sweep Pad', family: 'melodic' },
        { id: 'amen-loop', name: 'Amen Loop', family: 'loop' },
      ],
    } as unknown as Response)) as unknown as typeof fetch;
    const idx = await listInstruments(fetchFn);
    expect(idx.map((e) => e.id)).toEqual(['sweep-pad', 'amen-loop']);
    expect(idx.map((e) => e.family)).toEqual(['melodic', 'loop']);
  });

  it('reads one instrument manifest by id', async () => {
    const manifest: MelodicInstrumentManifest = {
      id: 'sweep-pad',
      name: 'Sweep Pad',
      family: 'melodic',
      zones: [{ file: 'sweep-pad/low.wav', rootNote: 48, loNote: 0, hiNote: 127 }],
    };
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => manifest } as unknown as Response)) as unknown as typeof fetch;
    const m = await fetchInstrumentManifest('sweep-pad', fetchFn);
    expect(m.id).toBe('sweep-pad');
    expect(m.family).toBe('melodic');
  });

  it('returns [] when the index is missing', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false } as unknown as Response)) as unknown as typeof fetch;
    expect(await listInstruments(fetchFn)).toEqual([]);
  });

  it('returns [] when the fetch throws', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await listInstruments(fetchFn)).toEqual([]);
  });

  it('throws when an instrument manifest is not found', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 } as unknown as Response)) as unknown as typeof fetch;
    await expect(fetchInstrumentManifest('missing', fetchFn)).rejects.toThrow();
  });
});
