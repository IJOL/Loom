// Pure: turn slice onsets (seconds) + the loop's tempo into a slice carve map
// plus a generated NoteEvent[] placed on the project grid. Slice N is mapped to
// MIDI SLICE_BASE_NOTE + N (contiguous rows for the loop editor).

import type { LoopSlice } from '../session/session';
import type { NoteEvent } from './notes';
import { TICKS_PER_QUARTER } from './notes';
import { quartersPerBar, type TimeSignature } from './meter';
import { resolutionToSnap, snapTickToRes, type ResolutionKey } from './drum-grid-editing';

/** First MIDI note slices map to (C2 = 36, the GM kick note — matches the
 *  drum-rack base so per-pad params line up visually). */
export const SLICE_BASE_NOTE = 36;

/** Whole-bar count for a loop of `durationSec` played at `bpm` in `meter`. */
export function barCountFor(durationSec: number, bpm: number, meter: TimeSignature): number {
  const secPerBeat = 60 / bpm;
  const barSec = quartersPerBar(meter) * secPerBeat;
  return Math.max(1, Math.round(durationSec / barSec));
}

export interface SliceClipResult {
  slices: LoopSlice[];
  notes: NoteEvent[];
  lengthBars: number;
}

export function buildSliceClip(opts: {
  slicePointsSec: number[];
  durationSec: number;
  originalBpm: number;
  projectMeter: TimeSignature;
  gridResolution: ResolutionKey;
}): SliceClipResult {
  const { durationSec, originalBpm, projectMeter, gridResolution } = opts;
  const lengthBars = barCountFor(durationSec, originalBpm, projectMeter);

  // Onsets: ensure a 0 boundary, sorted, de-duped, all < durationSec.
  const onsets = Array.from(new Set([0, ...opts.slicePointsSec]))
    .filter((t) => t >= 0 && t < durationSec)
    .sort((a, b) => a - b);
  if (onsets.length === 0) onsets.push(0);

  // Slice regions partition [0, durationSec).
  const slices: LoopSlice[] = onsets.map((start, i) => ({
    start,
    end: i + 1 < onsets.length ? onsets[i + 1] : durationSec,
    note: SLICE_BASE_NOTE + i,
  }));

  // Map each slice onset (a fraction of the loop) onto the clip's tick span,
  // quantized to the grid. The loop spans lengthBars; an onset at fraction f
  // lands at f * patternTicks.
  const patternTicks = lengthBars * quartersPerBar(projectMeter) * TICKS_PER_QUARTER;
  const snap = resolutionToSnap(gridResolution);
  const notes: NoteEvent[] = slices.map((s, i) => {
    const frac = s.start / durationSec;
    const start = snapTickToRes(Math.round(frac * patternTicks), snap);
    const next = i + 1 < slices.length ? slices[i + 1].start / durationSec : 1;
    const dur = Math.max(1, Math.round((next - frac) * patternTicks));
    return { start, duration: dur, midi: s.note, velocity: 90 };
  });

  return { slices, notes, lengthBars };
}
