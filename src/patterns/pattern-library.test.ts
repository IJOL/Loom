// The pattern library as the UI sees it: pick a style, get a named list of
// patterns; pick one, get NoteEvents. Reads the real JSON off disk rather than a
// fixture, so a malformed or renamed file fails here instead of in the browser.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLibrary, stylesWithPatterns, patternsFor, patternNotes } from './pattern-library';
import { STYLE_CATALOG, inScale } from '../core/musicality';
import { TICKS_PER_STEP } from '../core/notes';

const dir = join(process.cwd(), 'public', 'patterns');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

beforeAll(() => {
  setLibrary({
    synth: read('patterns-s1.json'),
    drums: read('patterns-t8-drums.json'),
    bass: read('patterns-t8-bass.json'),
    catalog: read('catalog.json'),
  });
});

describe('the pattern library', () => {
  it('offers patterns for every style in the catalog', () => {
    const styles = stylesWithPatterns();
    for (const { id, label } of STYLE_CATALOG) {
      expect(styles, `${label} has no patterns`).toContain(id);
    }
  });

  it('names every pattern it offers — a list of "Pattern 7" would be useless', () => {
    const list = patternsFor('techno', 'drums');
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.name).not.toMatch(/^Pattern \d+$/);
    }
  });

  it('turns a picked pattern into notes that actually play', () => {
    const notes = patternNotes('techno', 'drums', 0);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(0);
      expect(n.midi).toBeLessThanOrEqual(127);
      expect(n.duration).toBeGreaterThan(0);
    }
  });

  it('gives melodic patterns pitches around the root it is handed', () => {
    const notes = patternNotes('acid-techno', 'bass', 0, 36);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(Math.abs(n.midi - 36)).toBeLessThanOrEqual(24);
  });

  it('returns nothing for a pattern index that does not exist, rather than throwing', () => {
    expect(patternNotes('techno', 'drums', 9999)).toEqual([]);
  });
});

describe('the scale lock decides, and nothing else', () => {
  // The lock is the whole contract: open, the pattern arrives exactly as its
  // author wrote it — cromatismos included, because in acid those ARE the line.
  // Closed, every note is pulled into the project's key. 224 of the library's
  // 5705 melodic notes sit outside a minor scale on purpose.

  /** A library pattern that really does play out-of-key notes, or the snap test
   *  would prove nothing. */
  function findChromatic(): { style: string; index: number } | null {
    for (const style of ['acid-techno', 'idm', 'glitch', 'techno'] as const) {
      for (let i = 0; i < 20; i++) {
        const notes = patternNotes(style, 'bass', i, 36);
        if (notes.some((n) => !inScale(n.midi, 9, 'minor'))) return { style, index: i };
      }
    }
    return null;
  }

  it('changes not one note when the lock is open', () => {
    const hit = findChromatic();
    expect(hit, 'no chromatic pattern found — the snap test below would be vacuous').not.toBeNull();

    const notes = patternNotes(hit!.style as never, 'bass', hit!.index, 36);
    // Open lock = no snapTo passed. The out-of-key notes must survive.
    expect(notes.some((n) => !inScale(n.midi, 9, 'minor'))).toBe(true);
  });

  it('pulls every note into key when the lock is closed', () => {
    const hit = findChromatic()!;
    const notes = patternNotes(hit.style as never, 'bass', hit.index, 36, undefined, undefined, {
      key: 9, scale: 'minor',
    });
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });

  it('never snaps drums — GM notes are voices, not pitches', () => {
    const raw = patternNotes('techno', 'drums', 0, 36);
    const locked = patternNotes('techno', 'drums', 0, 36, undefined, undefined, { key: 9, scale: 'minor' });
    expect(locked).toEqual(raw);
  });
});

describe('filling the clip', () => {
  const BAR = 16 * TICKS_PER_STEP;   // 384 ticks — the library's patterns are one bar

  it('tiles a one-bar pattern across a two-bar clip — two bars is the house standard', () => {
    const notes = patternNotes('techno', 'drums', 0, 36, 2, BAR);
    const first = notes.filter((n) => n.start < BAR);
    const second = notes.filter((n) => n.start >= BAR);

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);       // the bar repeats, it does not trail off
    expect(Math.max(...notes.map((n) => n.start))).toBeLessThan(2 * BAR);
  });

  it('repeats the second bar note-for-note, one bar later', () => {
    const notes = patternNotes('techno', 'drums', 0, 36, 2, BAR);
    const first = notes.filter((n) => n.start < BAR);
    const second = notes.filter((n) => n.start >= BAR);

    for (let i = 0; i < first.length; i++) {
      expect(second[i].start).toBe(first[i].start + BAR);
      expect(second[i].midi).toBe(first[i].midi);
    }
  });

  it('leaves a one-bar clip alone', () => {
    const one = patternNotes('techno', 'drums', 0, 36, 1, BAR);
    const plain = patternNotes('techno', 'drums', 0);
    expect(one).toEqual(plain);
  });

  it('tiles melodic patterns too', () => {
    const notes = patternNotes('acid-techno', 'bass', 0, 36, 2, BAR);
    expect(notes.filter((n) => n.start >= BAR).length).toBeGreaterThan(0);
  });
});
