// @vitest-environment jsdom
// The two dropdowns: style, then that style's patterns. Both are native
// <select>s on purpose — the browser gives typeahead for free, so a 20-item
// style list and a 20-item pattern list need no search field.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLibrary } from './pattern-library';
import { fillStyleSelect, fillPatternSelect } from './pattern-picker-ui';

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

let sel: HTMLSelectElement;
beforeEach(() => { sel = document.createElement('select'); });

describe('the style dropdown', () => {
  it('lists every style, and marks the current one selected', () => {
    fillStyleSelect(sel, 'jungle');
    expect(sel.options.length).toBe(20);
    expect(sel.value).toBe('jungle');
  });

  it('shows human labels, not raw ids', () => {
    fillStyleSelect(sel, 'techno');
    const labels = [...sel.options].map((o) => o.textContent);
    expect(labels).toContain('Drum & Bass');
    expect(labels).not.toContain('drum-and-bass');
  });
});

describe('the pattern dropdown', () => {
  it('lists the picked style\'s patterns by name, with a placeholder first', () => {
    fillPatternSelect(sel, 'techno', ['drums']);
    expect(sel.options[0].value).toBe('');           // placeholder
    expect(sel.options.length).toBe(21);             // 20 patterns + placeholder
    const labels = [...sel.options].map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('Four on Floor'))).toBe(true);
  });

  it('carries each pattern\'s description, so the list explains itself', () => {
    fillPatternSelect(sel, 'techno', ['drums']);
    const four = [...sel.options].find((o) => o.textContent?.includes('Four on Floor'));
    expect(four?.title).toContain('kick');
  });

  it('re-fills from scratch when the style changes — no leftovers', () => {
    fillPatternSelect(sel, 'techno', ['drums']);
    fillPatternSelect(sel, 'ambient', ['synth']);
    const labels = [...sel.options].map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('Four on Floor'))).toBe(false);
    expect(labels.some((l) => l?.includes('Long Tone'))).toBe(true);
  });
});

describe('a lane that may read two shelves', () => {
  // An unmarked melodic lane reads bass AND lead — sourcesFor says so, and this
  // picker used to pick one of the two on the lane's behalf. Showing both is the
  // point; showing them as one undifferentiated run of forty names is not.
  it('lists both shelves, each under its own heading', () => {
    fillPatternSelect(sel, 'techno', ['bass', 'synth']);
    const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain('Library · Bass');
    expect(groups).toContain('Library · Lead');
  });

  it('drops the heading down to plain Library when there is only one shelf', () => {
    fillPatternSelect(sel, 'techno', ['drums']);
    const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Library']);
  });

  it('names the shelf in the VALUE, so an index still identifies a pattern', () => {
    // Two shelves both start at index 0. Without the kind in the value, picking
    // the first bass pattern and the first lead pattern is the same click.
    fillPatternSelect(sel, 'techno', ['bass', 'synth']);
    const values = [...sel.options].map((o) => o.value).filter(Boolean);
    expect(values).toContain('lib:bass:0');
    expect(values).toContain('lib:synth:0');
  });

  it('offers nothing from the library for a lane with no shelf at all', () => {
    // A chordal lane. Its material is generated, so an empty library here is the
    // answer — and an empty <optgroup> would read as a shelf that failed to load.
    fillPatternSelect(sel, 'techno', []);
    expect([...sel.querySelectorAll('optgroup')]).toHaveLength(0);
    expect(sel.options.length).toBe(1);              // the placeholder alone
  });
});

describe('one dropdown for everything that fills a clip', () => {
  // Loom's own examples and the imported library do the same job — put a
  // pattern in the clip — so they belong in one list, not two dropdowns.
  const examples = [
    { id: 'f1', name: 'Acid roller', source: 'factory' as const },
    { id: 'u1', name: 'My riff', source: 'user' as const },
  ];

  it('lists the library and our examples, grouped, in one select', () => {
    fillPatternSelect(sel, 'techno', ['drums'], examples);
    const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain('Library');
    expect(groups).toContain('Examples');
  });

  it('marks user examples so they are tellable from the shipped ones', () => {
    fillPatternSelect(sel, 'techno', ['drums'], examples);
    const mine = [...sel.options].find((o) => o.textContent?.includes('My riff'));
    expect(mine?.textContent).toContain('★');
  });

  it('keeps the two sources apart in the value, so applying picks the right path', () => {
    fillPatternSelect(sel, 'techno', ['drums'], examples);
    const values = [...sel.options].map((o) => o.value).filter(Boolean);
    expect(values.some((v) => v.startsWith('lib:'))).toBe(true);
    expect(values).toContain('ex:u1');
  });

  it('shows no Examples group when the style has none', () => {
    fillPatternSelect(sel, 'techno', ['drums'], []);
    const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).not.toContain('Examples');
  });
});
