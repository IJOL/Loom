// src/engines/sampler-keyboard-map.ts
// A horizontal mini-keyboard visualising a Sampler lane's keymap, matching the
// approved sampler mockup's instrument map (the mockup was pruned from the tree
// once shipped, per the design-history convention — recover it from git history).
//   • Drumkit (single-note pads): each pad's key is tinted its sound's colour — a
//     compact overview of where the kit sits. The sound name + key + delete live
//     in the per-pad strips (the rack) below, not here.
//   • Melodic (range zones): a colour band per zone at its true position, root marked.
// Read-only and async-free. The per-sample zoom viewer and the Sampler|Loop top
// selector are later increments (see 2026-06-07-sampler-visual-reorg-design.md).

import { html, render, nothing, type TemplateResult } from 'lit-html';
import type { KeymapEntry } from '../samples/types';
import { pc, noteName } from './note-name';
export { noteName } from './note-name';

const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (m: number): boolean => BLACK.has(pc(m));
/** Even hue spread, matching the mockup's per-index colouring. */
export const padHue = (i: number, n: number): number => Math.round((i * 360) / Math.max(1, n));
export const padColor = (i: number, n: number): string => `hsl(${padHue(i, n)},65%,56%)`;

export interface KeyboardMapOpts { drumkit: boolean }

/** Render the keyboard map for `keymap` into `host` (cleared first). No-op for an
 *  empty keymap (host left empty so the caller can keep it hidden). */
export function renderSamplerKeyboardMap(host: HTMLElement, keymap: KeymapEntry[], opts: KeyboardMapOpts): void {
  host.innerHTML = '';
  if (!keymap.length) return;
  const n = keymap.length;

  // Visible window: span every pad/zone with a little padding, clamped to [0,127].
  // A single very wide melodic zone (e.g. 0..127) would dwarf the roots, so window
  // around the roots instead.
  let lo = Math.min(...keymap.map((e) => Math.min(e.loNote, e.rootNote)));
  let hi = Math.max(...keymap.map((e) => Math.max(e.hiNote, e.rootNote)));
  if (hi - lo > 60) {
    const roots = keymap.map((e) => e.rootNote);
    lo = Math.min(...roots) - 4;
    hi = Math.max(...roots) + 16;
  } else {
    lo -= 1; hi += 1;
  }
  lo = Math.max(0, lo); hi = Math.min(127, hi);
  const span = Math.max(1, hi - lo + 1);
  const leftPct = (m: number): number => ((m - lo) / span) * 100;
  const widthPct = (semis: number): number => (semis / span) * 100;

  // Pad-key → colour, so the keys can be tinted (drumkit) / a zone band drawn (melodic).
  const keyTint = new Map<number, string>();
  if (opts.drumkit) keymap.forEach((e, i) => keyTint.set(e.rootNote, padColor(i, n)));

  const band = opts.drumkit ? nothing : html`
    <div class="smk-band">${keymap.map((e, i) => {
      const c = padColor(i, n);
      return html`<div class="smk-zone"
          style="left:${leftPct(e.loNote)}%;width:${widthPct(e.hiNote - e.loNote + 1)}%;background:hsla(${padHue(i, n)},65%,56%,0.32);border-color:${c}"
          title="${noteName(e.loNote)}–${noteName(e.hiNote)} · root ${noteName(e.rootNote)}"></div>
        <div class="smk-root" style="left:${leftPct(e.rootNote) + widthPct(0.5)}%;background:${c}"></div>`;
    })}</div>`;

  // Keys (one cell per semitone in the window). data-note feeds the
  // keyboard→strip connectors.
  const keys: TemplateResult[] = [];
  for (let m = lo; m <= hi; m++) {
    const tint = keyTint.get(m);
    keys.push(html`<div
      class="smk-key${isBlack(m) ? ' black' : ''}${pc(m) === 0 ? ' c' : ''}${tint ? ' pad' : ''}"
      data-note="${m}" style=${tint ? `background:${tint}` : nothing}></div>`);
  }

  // One-shot render into a throwaway fragment: a fresh fragment per call keeps
  // lit's part state off `host`, whose innerHTML callers may wipe at will.
  const frag = document.createDocumentFragment();
  render(html`<div class="smk-wrap">${band}<div class="smk-keys">${keys}</div></div>`, frag);
  host.appendChild(frag);
}
