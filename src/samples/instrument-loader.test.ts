// src/samples/instrument-loader.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildMelodicKeymap,
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
