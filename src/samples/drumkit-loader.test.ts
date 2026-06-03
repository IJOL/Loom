// src/samples/drumkit-loader.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  buildDrumkitKeymap,
  loadDrumkit,
  listDrumkits,
  fetchDrumkitManifest,
  type DrumkitManifest,
} from './drumkit-loader';

const MANIFEST: DrumkitManifest = {
  id: 'tr808',
  name: 'TR-808 (samples)',
  samples: [
    { voice: 'kick', note: 36, file: 'tr808/kick.wav' },
    { voice: 'snare', note: 38, file: 'tr808/snare.wav' },
    { voice: 'closedHat', note: 42, file: 'tr808/closedHat.wav', gain: 0.8 },
  ],
};

describe('buildDrumkitKeymap (pure)', () => {
  it('pins each sample to a single-note pad at its GM note (lo===hi===root)', () => {
    const km = buildDrumkitKeymap(MANIFEST.samples, ['a', 'b', 'c']);
    expect(km).toHaveLength(3);
    expect(km[0]).toEqual({ sampleId: 'a', rootNote: 36, loNote: 36, hiNote: 36 });
    expect(km[1]).toEqual({ sampleId: 'b', rootNote: 38, loNote: 38, hiNote: 38 });
    // gain carried through only when present
    expect(km[2]).toEqual({ sampleId: 'c', rootNote: 42, loNote: 42, hiNote: 42, gain: 0.8 });
  });

  it('keeps sampleId order aligned to samples', () => {
    const km = buildDrumkitKeymap(MANIFEST.samples, ['x', 'y', 'z']);
    expect(km.map((e) => e.sampleId)).toEqual(['x', 'y', 'z']);
  });

  it('throws when ids count does not match samples count', () => {
    expect(() => buildDrumkitKeymap(MANIFEST.samples, ['only-one'])).toThrow();
  });
});

describe('loadDrumkit (impure, injected deps)', () => {
  const fakeBuffer = { duration: 0.4, sampleRate: 44100, numberOfChannels: 1 } as unknown as AudioBuffer;
  const ctx = { decodeAudioData: vi.fn(async () => fakeBuffer) } as unknown as AudioContext;

  it('fetches + decodes + stores + caches each voice and returns a GM-note keymap', async () => {
    const fetched: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      fetched.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) } as unknown as Response;
    }) as unknown as typeof fetch;
    const stored: string[] = [];
    const cached: string[] = [];
    const store = { put: vi.fn(async (a: { id: string }) => { stored.push(a.id); }) };
    const cache = { put: vi.fn((id: string) => { cached.push(id); }) };

    const km = await loadDrumkit(MANIFEST, ctx, { store, cache, fetchFn, now: () => 1234 });

    // one fetch per voice, at the /drumkits/<file> path
    expect(fetched).toEqual(['/drumkits/tr808/kick.wav', '/drumkits/tr808/snare.wav', '/drumkits/tr808/closedHat.wav']);
    // stored + cached once per voice, ids aligned
    expect(stored).toHaveLength(3);
    expect(cached).toEqual(stored);
    // keymap is single-note at the GM notes, fresh ids === the stored ids
    expect(km.map((e) => e.rootNote)).toEqual([36, 38, 42]);
    expect(km.every((e) => e.loNote === e.rootNote && e.hiNote === e.rootNote)).toBe(true);
    expect(km.map((e) => e.sampleId)).toEqual(stored);
  });
});

describe('listDrumkits / fetchDrumkitManifest', () => {
  it('reads the bundled index', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: 'tr808', name: 'TR-808 (samples)' }, { id: 'acoustic', name: 'Acoustic / Dirt (samples)' }],
    } as unknown as Response)) as unknown as typeof fetch;
    const idx = await listDrumkits(fetchFn);
    expect(idx.map((k) => k.id)).toEqual(['tr808', 'acoustic']);
  });

  it('reads one kit manifest by id', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => MANIFEST } as unknown as Response)) as unknown as typeof fetch;
    const m = await fetchDrumkitManifest('tr808', fetchFn);
    expect(m.id).toBe('tr808');
    expect(m.samples).toHaveLength(3);
  });

  it('returns [] when the index is missing', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false } as unknown as Response)) as unknown as typeof fetch;
    expect(await listDrumkits(fetchFn)).toEqual([]);
  });
});
