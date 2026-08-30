// src/notefx/notefx-fields.ts
// The two field shapes every note-FX card is built from. Shared by the panel
// (arp + random cards) and the chord card, which lives in its own file.

import { html, type TemplateResult } from 'lit-html';

export function selectField(
  label: string, opts: string[], value: string, onChange: (v: string) => void,
): TemplateResult {
  return html`<label class="notefx-field">${label}<select
    @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
  >${opts.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}</select></label>`;
}

/** Like selectField, but each option carries a VALUE and a shown LABEL — for
 *  selects whose stored values are not fit to read ('session', '0'..'11'). */
export function pairedSelectField(
  label: string, pairs: ReadonlyArray<readonly [string, string]>, value: string,
  onChange: (v: string) => void,
): TemplateResult {
  return html`<label class="notefx-field">${label}<select
    @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
  >${pairs.map(([v, l]) => html`<option value=${v} ?selected=${v === value}>${l}</option>`)}</select></label>`;
}

export function numberField(
  label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void,
): TemplateResult {
  return html`<label class="notefx-field">${label}<input
    type="range" min=${min} max=${max} step=${step} .value=${String(value)}
    @input=${(e: Event) => onChange(Number((e.target as HTMLInputElement).value))}
  /></label>`;
}
