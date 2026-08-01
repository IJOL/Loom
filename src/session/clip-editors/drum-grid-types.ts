// Display types + layout constants for the canvas drum-rack editor. Split out of
// clip-editor-drum-grid.ts (which holds the renderer) to keep each under budget.

import type { DrumVoice } from '../../core/drums';
import type { DrumRows } from '../../core/drum-grid-editing';
import type { ClipAxis } from '../../core/clip-axis';
import type { HistoryDeps } from '../../save/history-wiring';

export const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', rimshot: 'RIM', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE', crash: 'CRASH',
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

export interface DrumEditorHandle {
  redraw: () => void;
  /** Release the ClipAxis subscription + the primary-viewport registration.
   *  Called before the host is wiped (see combineEditorHandle). */
  dispose?: () => void;
}

export interface DrumEditorDeps {
  auditionNote?: (midi: number) => void;
  getPlayheadTick?: () => number;        // -1 when not playing
  /** The clip's shared horizontal time axis. The editor is the PRIMARY: it
   *  publishes its viewport width and drives zoom/scroll for every follower
   *  (waveform header, automation lanes). Optional so existing tests can mount
   *  the editor standalone; without it the grid gets its own private axis and
   *  simply has no followers. */
  axis?: ClipAxis;
  /** Sampler drumkit lanes only: lets the editor show a "Full kit" toggle and
   *  rebuild its row model in place. build(full) returns the model for the
   *  requested view; the global flag is owned by clip-drum-fullkit. */
  fullKit?: { build: (full: boolean) => DrumGridModel; onToggle?: () => void };
  /** The editor changed the clip's length itself ("Fit clip" in the Euclidean
   *  panel). Whoever shows the length elsewhere — the inspector's Length field —
   *  re-reads the clip; nobody else knows it moved. */
  onClipResized?: () => void;
  /** When present, mount the loop overlay over the grid (toolbar in loop.toolbarHost). */
  loop?: {
    toolbarHost: HTMLElement;
    historyDeps?: HistoryDeps;
    onChange?: () => void;
    /** Returns true when the editing scene's loop is currently linked. */
    isLinked?: () => boolean;
    /** Called when the user clicks the Link toggle in the loop toolbar. */
    onToggleLink?: (linked: boolean) => void;
    /** Called after each loop edit commit (toggle + brace drags). */
    onClipLoopEdited?: () => void;
  };
}
