// src/samples/instrument-loader.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  buildMelodicKeymap,
  loadInstrument,
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

describe('loadInstrument (melodic, impure, injected deps)', () => {
  const fakeBuffer = { duration: 1.2, sampleRate: 44100, numberOfChannels: 2 } as unknown as AudioBuffer;
  const ctx = { decodeAudioData: vi.fn(async () => fakeBuffer) } as unknown as AudioContext;

  const MELODIC: MelodicInstrumentManifest = {
    id: 'sweep-pad',
    name: 'Sweep Pad',
    family: 'melodic',
    zones: [
      { file: 'sweep-pad/low.wav', rootNote: 48, loNote: 0, hiNote: 59 },
      { file: 'sweep-pad/high.wav', rootNote: 72, loNote: 60, hiNote: 127, gain: 0.8 },
    ],
    padParams: { 48: { cutoff: 0.5 } },
  };

  it('fetches + decodes + stores + caches each zone and returns a multi-zone keymap', async () => {
    const fetched: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      fetched.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) } as unknown as Response;
    }) as unknown as typeof fetch;
    const stored: string[] = [];
    const cached: string[] = [];
    const store = { put: vi.fn(async (a: { id: string }) => { stored.push(a.id); }) };
    const cache = { put: vi.fn((id: string) => { cached.push(id); }) };

    const { keymap, padParams } = await loadInstrument(MELODIC, ctx, { store, cache, fetchFn, now: () => 1234 });

    // one fetch per zone, at the /instruments/<file> path
    expect(fetched).toEqual(['/instruments/sweep-pad/low.wav', '/instruments/sweep-pad/high.wav']);
    // stored + cached once per zone, ids aligned
    expect(stored).toHaveLength(2);
    expect(cached).toEqual(stored);
    // keymap mirrors the zones, fresh ids === the stored ids, ranges intact
    expect(keymap.map((e) => e.rootNote)).toEqual([48, 72]);
    expect(keymap.map((e) => [e.loNote, e.hiNote])).toEqual([[0, 59], [60, 127]]);
    expect(keymap[1].gain).toBe(0.8);
    expect(keymap.map((e) => e.sampleId)).toEqual(stored);
    // padParams passed through untouched
    expect(padParams).toEqual({ 48: { cutoff: 0.5 } });
  });

  it('self-heals: two loads yield distinct sampleIds but the same note↔zone mapping', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) } as unknown as Response)) as unknown as typeof fetch;
    const store = { put: vi.fn(async () => {}) };
    const cache = { put: vi.fn() };

    const a = await loadInstrument(MELODIC, ctx, { store, cache, fetchFn });
    const b = await loadInstrument(MELODIC, ctx, { store, cache, fetchFn });

    // ids differ between loads
    expect(a.keymap.map((e) => e.sampleId)).not.toEqual(b.keymap.map((e) => e.sampleId));
    // but the note↔zone mapping is identical
    expect(a.keymap.map((e) => [e.rootNote, e.loNote, e.hiNote]))
      .toEqual(b.keymap.map((e) => [e.rootNote, e.loNote, e.hiNote]));
  });

  it('omits padParams when the manifest has none', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) } as unknown as Response)) as unknown as typeof fetch;
    const { padParams } = await loadInstrument(
      { ...MELODIC, padParams: undefined },
      ctx,
      { store: { put: vi.fn(async () => {}) }, cache: { put: vi.fn() }, fetchFn },
    );
    expect(padParams).toBeUndefined();
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
