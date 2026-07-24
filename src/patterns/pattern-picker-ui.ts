// SPDX-License-Identifier: AGPL-3.0-or-later
// The pattern picker: a style dropdown, then that style's patterns.
//
// Both are plain <select>s, deliberately. 20 styles x 20 patterns is far too
// much for a menu you scroll, but a native select already answers that: it has
// typeahead built in (type "jun" and land on Jungle), so the list needs no
// search field of its own — and it costs no code, works on mobile, and is
// keyboard-navigable for free.

import { html, type TemplateResult } from 'lit-html';
import { ifDefined } from 'lit-html/directives/if-defined.js';
import { renderInto } from '../core/lit-fill';
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
  renderInto(sel, html`${STYLE_CATALOG.map(({ id, label }) => html`<option value=${id}>${label}</option>`)}`);
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
  // Empty groups render nothing — the old imperative fill never appended an
  // empty <optgroup> either.
  const group = (label: string, items: TemplateResult[]) =>
    items.length ? html`<optgroup label=${label}>${items}</optgroup>` : null;

  const lib = patternsFor(style, kind).map((p) =>
    html`<option value=${`lib:${p.index}`} title=${ifDefined(p.desc || undefined)}>${p.name}</option>`);
  const ex = examples.map((e) =>
    html`<option value=${`ex:${e.id}`}>${e.source === 'user' ? `★ ${e.name}` : e.name}</option>`);

  renderInto(sel, html`<option value="">— pattern… —</option>${group('Library', lib)}${group('Examples', ex)}`);
  sel.value = '';
}
