// Display types + layout constants for the canvas drum-rack editor. Split out of
// clip-editor-drum-grid.ts (which holds the renderer) to keep each under budget.

import type { DrumVoice } from '../../core/drums';
import type { DrumRows } from '../../core/drum-grid-editing';

export const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

/** The rows the editor draws: how many (rows.count), how notes map to them, and a
 *  label per row. Defaults to the fixed 8 GM voices when the caller omits it. */
export interface DrumGridModel { rows: DrumRows; labels: string[] }

export const LABEL_W = 54;
export const RULER_H = 20;
export const ROW_H = 22;
export const VEL_LANE_H = 46;                // velocity lane band

// Drum-grid keyboard legend (the real key set handled in the keydown — no
// note-typing here). Kept exported so the on-screen help cannot drift.
export const DRUM_KEY_LEGEND =
  'Keyboard:  1 / 2 = pencil / select · ←/→ = move · ↑/↓ = change voice\n' +
  '           Ctrl+A = select all · Ctrl+C / Ctrl+X / Ctrl+V = copy / cut / paste\n' +
  '           Esc = deselect · ⌫ = delete';

export interface DrumEditorHandle { redraw: () => void; }
