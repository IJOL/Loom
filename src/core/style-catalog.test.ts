// One style catalog for the whole program: the same list drives Project Options,
// the generators and the imported pattern library. A style that is listed but
// generates nothing is worse than absent — the UI offers it and it does nothing.

import { describe, it, expect } from 'vitest';
import { STYLE_CATALOG } from './musicality';
import { generate, type GenContext } from './generators';
import { inScale } from './musicality';

function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ctx = (): GenContext => ({
  key: 9, scale: 'minor', bars: 2, stepsPerBar: 16, octaveBase: 36, rng: mulberry32(7),
});

// The genre keys of the imported pattern library, verbatim. The style ids ARE
// these keys, so a pattern lookup is `patterns[style]` with no translation table
// to drift out of sync.
const LIBRARY_STYLES = [
  'techno', 'acid-techno', 'trance', 'dub-techno', 'idm', 'edm', 'drum-and-bass',
  'house', 'breakbeat', 'jungle', 'garage', 'ambient', 'glitch', 'electro',
  'downtempo', 'dubstep', 'lo-fi', 'synthwave', 'deep-house', 'psytrance',
];

describe('the style catalog', () => {
  it('covers every genre the pattern library ships', () => {
    const ids = STYLE_CATALOG.map((s) => s.id);
    for (const style of LIBRARY_STYLES) {
      expect(ids, `style "${style}" is missing from STYLE_CATALOG`).toContain(style);
    }
  });

  it('has no duplicate ids and labels every style', () => {
    const ids = STYLE_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STYLE_CATALOG) expect(s.label.length).toBeGreaterThan(0);
  });

  it('makes every listed style actually generate — bass, melody and beat', () => {
    for (const { id, label } of STYLE_CATALOG) {
      for (const kind of ['bass', 'melody', 'beat'] as const) {
        const notes = generate(kind, id, ctx());
        expect(notes.length, `${label} generates no ${kind}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every generated bass and melody note in key, in every style', () => {
    for (const { id, label } of STYLE_CATALOG) {
      for (const kind of ['bass', 'melody'] as const) {
        for (const n of generate(kind, id, ctx())) {
          expect(inScale(n.midi, 9, 'minor'), `${label} ${kind} played ${n.midi}, out of key`).toBe(true);
        }
      }
    }
  });
});
