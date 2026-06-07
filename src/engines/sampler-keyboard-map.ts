// src/engines/sampler-keyboard-map.ts
// A horizontal mini-keyboard visualising a Sampler lane's keymap, matching the
// mockup's instrument map (docs/superpowers/mockups/sampler-mockup.html).
//   • Drumkit (single-note pads): each pad's key is tinted its sound's colour — a
//     compact overview of where the kit sits. The sound name + key + delete live
//     in the per-pad strips (the rack) below, not here.
//   • Melodic (range zones): a colour band per zone at its true position, root marked.
// Read-only and async-free. The per-sample zoom viewer and the Sampler|Loop top
// selector are later increments (see 2026-06-07-sampler-visual-reorg-design.md).

import type { KeymapEntry } from '../samples/types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const pc = (m: number): number => ((m % 12) + 12) % 12;
const isBlack = (m: number): boolean => BLACK.has(pc(m));
/** e.g. 38 → "D1" (MIDI octave −1 convention used across Loom). */
export const noteName = (m: number): string => `${NOTE_NAMES[pc(m)]}${Math.floor(m / 12) - 1}`;
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

  const wrap = document.createElement('div');
  wrap.className = 'smk-wrap';

  // Pad-key → colour, so the keys can be tinted (drumkit) / a zone band drawn (melodic).
  const keyTint = new Map<number, string>();
  let band: HTMLElement | null = null;
  if (opts.drumkit) {
    keymap.forEach((e, i) => keyTint.set(e.rootNote, padColor(i, n)));
  } else {
    band = document.createElement('div');
    band.className = 'smk-band';
    keymap.forEach((e, i) => {
      const c = padColor(i, n);
      const seg = document.createElement('div');
      seg.className = 'smk-zone';
      seg.style.left = `${leftPct(e.loNote)}%`;
      seg.style.width = `${widthPct(e.hiNote - e.loNote + 1)}%`;
      seg.style.background = `hsla(${padHue(i, n)},65%,56%,0.32)`;
      seg.style.borderColor = c;
      seg.title = `${noteName(e.loNote)}–${noteName(e.hiNote)} · root ${noteName(e.rootNote)}`;
      band!.appendChild(seg);
      const root = document.createElement('div');
      root.className = 'smk-root';
      root.style.left = `${leftPct(e.rootNote) + widthPct(0.5)}%`;
      root.style.background = c;
      band!.appendChild(root);
    });
  }

  // Keys (one cell per semitone in the window).
  const keys = document.createElement('div');
  keys.className = 'smk-keys';
  for (let m = lo; m <= hi; m++) {
    const k = document.createElement('div');
    k.className = `smk-key${isBlack(m) ? ' black' : ''}${pc(m) === 0 ? ' c' : ''}`;
    const tint = keyTint.get(m);
    if (tint) { k.classList.add('pad'); k.style.background = tint; }
    keys.appendChild(k);
  }

  if (band) wrap.appendChild(band);
  wrap.appendChild(keys);
  host.appendChild(wrap);
}
