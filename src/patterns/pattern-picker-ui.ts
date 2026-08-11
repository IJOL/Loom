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
import { patternsFor, KIND_LABEL, type PatternKind } from './pattern-library';

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
 *  `kinds` is which SHELVES this lane may read, and it comes from `sourcesFor`
 *  — the one door — so this list and WEAVE's offer the same material. It is a
 *  list rather than one kind because that answer legitimately has two entries:
 *  a melodic lane nobody has marked reads bass AND lead, and picking one of them
 *  here on the lane's behalf is the guess this round exists to stop making. Each
 *  shelf gets its own heading, so a two-shelf list still reads as two shelves.
 *
 *  Values are prefixed by source (`lib:<kind>:<index>` / `ex:<id>`) because the
 *  two are applied differently: library patterns are semitone offsets from the
 *  root, examples are scale degrees rendered into the project's tonality. The
 *  KIND rides in the value for the plain reason that with two shelves listed an
 *  index no longer identifies a pattern on its own.
 *
 *  Descriptions ride along as the option's title, so hovering explains a
 *  pattern without opening anything. */
export function fillPatternSelect(
  sel: HTMLSelectElement,
  style: StyleId,
  kinds: PatternKind[],
  examples: PickerExample[] = [],
): void {
  // Empty groups render nothing — the old imperative fill never appended an
  // empty <optgroup> either.
  const group = (label: string, items: TemplateResult[]) =>
    items.length ? html`<optgroup label=${label}>${items}</optgroup>` : null;

  const shelves = kinds.map((kind) => group(
    kinds.length > 1 ? `Library · ${KIND_LABEL[kind]}` : 'Library',
    patternsFor(style, kind).map((p) =>
      html`<option value=${`lib:${kind}:${p.index}`} title=${ifDefined(p.desc || undefined)}>${p.name}</option>`),
  ));
  const ex = examples.map((e) =>
    html`<option value=${`ex:${e.id}`}>${e.source === 'user' ? `★ ${e.name}` : e.name}</option>`);

  renderInto(sel, html`<option value="">— pattern… —</option>${shelves}${group('Examples', ex)}`);
  sel.value = '';
}
