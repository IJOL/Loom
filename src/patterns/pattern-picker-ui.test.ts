// @vitest-environment jsdom
// The two dropdowns: style, then that style's patterns. Both are native
// <select>s on purpose — the browser gives typeahead for free, so a 20-item
// style list and a 20-item pattern list need no search field.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLibrary } from './pattern-library';
import { patternKindFor, fillStyleSelect, fillPatternSelect } from './pattern-picker-ui';

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

describe('patternKindFor', () => {
  it('routes each lane engine to the pool that suits it', () => {
    expect(patternKindFor('drums-machine')).toBe('drums');
    expect(patternKindFor('tb303')).toBe('bass');
    expect(patternKindFor('subtractive')).toBe('synth');
    expect(patternKindFor('fm')).toBe('synth');
  });
});

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
    fillPatternSelect(sel, 'techno', 'drums');
    expect(sel.options[0].value).toBe('');           // placeholder
    expect(sel.options.length).toBe(21);             // 20 patterns + placeholder
    const labels = [...sel.options].map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('Four on Floor'))).toBe(true);
  });

  it('carries each pattern\'s description, so the list explains itself', () => {
    fillPatternSelect(sel, 'techno', 'drums');
    const four = [...sel.options].find((o) => o.textContent?.includes('Four on Floor'));
    expect(four?.title).toContain('kick');
  });

  it('re-fills from scratch when the style changes — no leftovers', () => {
    fillPatternSelect(sel, 'techno', 'drums');
    fillPatternSelect(sel, 'ambient', 'synth');
    const labels = [...sel.options].map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('Four on Floor'))).toBe(false);
    expect(labels.some((l) => l?.includes('Long Tone'))).toBe(true);
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
    fillPatternSelect(sel, 'techno', 'drums', examples);
    const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain('Library');
    expect(groups).toContain('Examples');
  });

  it('marks user examples so they are tellable from the shipped ones', () => {
    fillPatternSelect(sel, 'techno', 'drums', examples);
    const mine = [...sel.options].find((o) => o.textContent?.includes('My riff'));
    expect(mine?.textContent).toContain('★');
  });

  it('keeps the two sources apart in the value, so applying picks the right path', () => {
    fillPatternSelect(sel, 'techno', 'drums', examples);
    const values = [...sel.options].map((o) => o.value).filter(Boolean);
    expect(values.some((v) => v.startsWith('lib:'))).toBe(true);
    expect(values).toContain('ex:u1');
  });

  it('shows no Examples group when the style has none', () => {
    fillPatternSelect(sel, 'techno', 'drums', []);
    const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).not.toContain('Examples');
  });
});
