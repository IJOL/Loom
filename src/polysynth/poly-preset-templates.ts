// src/polysynth/poly-preset-templates.ts
// Shared option templates for the preset <select>s polysynth-presets fills
// (#poly-preset-select and the per-page 303/drums selects). Option values keep
// the dropdown vocabulary (`__custom__`, `engine:<name>`, `user:<name>`,
// `sampler:…`) — pagePresetName and the change handlers key off it.

import { html, type TemplateResult } from 'lit-html';

/** The leading "(custom — no preset)" option every preset select starts with. */
export function customOption(): TemplateResult {
  return html`<option value="__custom__">(custom — no preset)</option>`;
}

/** An <optgroup> of [value, label] preset options; an empty group renders
 *  nothing (the old imperative fill never appended an empty optgroup). */
export function presetGroup(label: string, items: [string, string][]): TemplateResult | null {
  if (items.length === 0) return null;
  return html`<optgroup label=${label}>${items.map(([value, text]) =>
    html`<option value=${value}>${text}</option>`)}</optgroup>`;
}
