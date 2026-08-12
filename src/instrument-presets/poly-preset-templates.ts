// src/polysynth/poly-preset-templates.ts
// Shared option templates for the preset <select>s polysynth-presets fills
// (#instrument-preset-select and the per-page 303/drums selects). Option values keep
// the dropdown vocabulary (`__custom__`, `engine:<name>`, `user:<name>`,
// `sampler:…`) — pagePresetName and the change handlers key off it.

import { html, type TemplateResult } from 'lit-html';

/** The leading "(custom — no preset)" option every preset select starts with. */
export function customOption(): TemplateResult {
  return html`<option value="__custom__">(custom — no preset)</option>`;
}

/** An <optgroup> of [value, label] preset options; an empty group renders
 *  nothing (the old imperative fill never appended an empty optgroup). */
/** A group's items in the order a person reads them: by NAME, case- and
 *  accent-insensitively, numbers counted as numbers so "Pad 2" precedes
 *  "Pad 10".
 *
 *  Here rather than at each call site because a dropdown whose groups are each
 *  sorted differently reads as unsorted — which is what the sampler's did, one
 *  group per source file, each in whatever order its index happened to list. */
export function byName(items: [string, string][]): [string, string][] {
  return [...items].sort((a, b) => a[1].localeCompare(b[1], undefined, {
    sensitivity: 'base', numeric: true,
  }));
}

export function presetGroup(label: string, items: [string, string][]): TemplateResult | null {
  if (items.length === 0) return null;
  return html`<optgroup label=${label}>${items.map(([value, text]) =>
    html`<option value=${value}>${text}</option>`)}</optgroup>`;
}
