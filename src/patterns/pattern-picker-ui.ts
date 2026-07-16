// SPDX-License-Identifier: AGPL-3.0-or-later
// The pattern picker: a style dropdown, then that style's patterns.
//
// Both are plain <select>s, deliberately. 20 styles x 20 patterns is far too
// much for a menu you scroll, but a native select already answers that: it has
// typeahead built in (type "jun" and land on Jungle), so the list needs no
// search field of its own — and it costs no code, works on mobile, and is
// keyboard-navigable for free.

import { STYLE_CATALOG, type StyleId } from '../core/musicality';
import { patternsFor, type PatternKind } from './pattern-library';

/** Which pattern pool suits a lane's engine. Drum lanes want drum patterns;
 *  the 303 is a bass machine; everything else melodic reads the synth pool. */
export function patternKindFor(engineId: string): PatternKind {
  if (engineId === 'drums-machine') return 'drums';
  if (engineId === 'tb303') return 'bass';
  return 'synth';
}

/** Where a library pattern's root note sits.
 *
 *  A library pattern is semitone offsets from a root, so the root is what makes
 *  it transposable. Rooting it on the octave alone would play every pattern in C
 *  regardless of the project's key — our own examples are scale degrees and
 *  transpose for free, and a pattern must behave the same way.
 *
 *  `octaveBase` keeps the octave selector honoured; `key` (0-11) moves it to the
 *  project's tonic. */
export function patternRootFor(octaveBase: number, key: number): number {
  return octaveBase + key;
}

/** Fill the style dropdown with every style, selecting `current`. */
export function fillStyleSelect(sel: HTMLSelectElement, current: StyleId): void {
  sel.innerHTML = '';
  for (const { id, label } of STYLE_CATALOG) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = current;
}

/** An example of ours, as the picker needs to show it. */
export interface PickerExample {
  id: string;
  name: string;
  source?: 'factory' | 'user';
}

/** Fill the pattern dropdown for a style: the imported library plus our own
 *  examples for that style, grouped, in ONE list — both do the same job (put a
 *  pattern in the clip), so two dropdowns would just be two places to look.
 *
 *  Values are prefixed by source (`lib:<index>` / `ex:<id>`) because the two
 *  are applied differently: library patterns are semitone offsets from the
 *  root, examples are scale degrees rendered into the project's tonality.
 *
 *  Descriptions ride along as the option's title, so hovering explains a
 *  pattern without opening anything. */
export function fillPatternSelect(
  sel: HTMLSelectElement,
  style: StyleId,
  kind: PatternKind,
  examples: PickerExample[] = [],
): void {
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '— pattern… —';
  sel.appendChild(ph);

  const addGroup = (label: string, fill: (g: HTMLOptGroupElement) => void): void => {
    const g = document.createElement('optgroup');
    g.label = label;
    fill(g);
    if (g.children.length) sel.appendChild(g);
  };

  addGroup('Library', (g) => {
    for (const p of patternsFor(style, kind)) {
      const o = document.createElement('option');
      o.value = `lib:${p.index}`;
      o.textContent = p.name;
      if (p.desc) o.title = p.desc;
      g.appendChild(o);
    }
  });

  addGroup('Examples', (g) => {
    for (const e of examples) {
      const o = document.createElement('option');
      o.value = `ex:${e.id}`;
      o.textContent = e.source === 'user' ? `★ ${e.name}` : e.name;
      g.appendChild(o);
    }
  });

  sel.value = '';
}
