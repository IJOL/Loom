import { randomize, type ScaleName, type RandomizeOptions } from './random';
import { TICKS_PER_STEP, type NoteEvent } from './notes';
import type { Sequencer } from './sequencer';
import type { TB303 } from './synth';
import type { PianoRollHandle } from './pianoroll';

// ── Per-lane randomize helpers ────────────────────────────────────────────

export interface RollEntryRef {
  handle: PianoRollHandle;
}

export interface RandomizeUIDeps {
  seq: Sequencer;
  synth: TB303;
  scaleSel: HTMLSelectElement;
  rootSel: HTMLSelectElement;
  /** Returns the current bassRollEntry (may be null). */
  getBassRollEntry: () => RollEntryRef | null;
  refreshAllCellsFromState: () => void;
  refreshKnobsFromSynth: () => void;
  rebuildPolyTrack: () => void;
  rebuildRollsView: () => void;
  /** Returns the currently-active engine lane id (e.g. 'main', 'poly1'). */
  getActiveEngineLaneId: () => string;
}

function currentRandomBase(deps: RandomizeUIDeps): RandomizeOptions {
  return {
    scale: deps.scaleSel.value as ScaleName,
    rootNote: parseInt(deps.rootSel.value, 10),
  };
}

function randomizeBassNotes(deps: RandomizeUIDeps): void {
  const base = currentRandomBase(deps);
  randomize(deps.seq, deps.synth, { ...base, bassNotes: true, accents: true, slides: true });
  deps.refreshAllCellsFromState();
  deps.getBassRollEntry()?.handle.redraw();
}

function randomizeBassSound(deps: RandomizeUIDeps): void {
  const base = currentRandomBase(deps);
  randomize(deps.seq, deps.synth, { ...base, mod: true });
  deps.refreshKnobsFromSynth();
}

function randomizeDrumsLane(deps: RandomizeUIDeps): void {
  const base = currentRandomBase(deps);
  randomize(deps.seq, deps.synth, { ...base, drums: true });
  deps.refreshAllCellsFromState();
}

// Scale intervals; same set used by random.ts
const SCALE_INTERVALS: Record<string, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** Random notes for a single poly lane: scale-aware, sparse, musical. */
function randomizePolyLaneNotes(deps: RandomizeUIDeps, laneId: string): void {
  const scale = deps.scaleSel.value as ScaleName;
  const root  = parseInt(deps.rootSel.value, 10);
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.pentMinor;

  // Random note from scale around `root + 24` for poly range
  const pickMidi = () => {
    const oct = Math.floor(Math.random() * 3); // 0..2 octaves above root
    const iv  = intervals[Math.floor(Math.random() * intervals.length)];
    return root + 36 + oct * 12 + iv;
  };

  const { seq } = deps;
  const len = seq.pattern.length;

  if (laneId === 'main') {
    if (seq.pattern.polyMode === 'piano') {
      // Sparse piano-roll: ~30% step density, notes of 1-2 steps duration
      const out: NoteEvent[] = [];
      for (let i = 0; i < len; i++) {
        if (Math.random() < 0.3) {
          out.push({
            start: i * TICKS_PER_STEP,
            duration: TICKS_PER_STEP * (Math.random() < 0.3 ? 2 : 1),
            midi: pickMidi(),
            velocity: Math.random() < 0.25 ? 115 : 80,
          });
        }
      }
      seq.pattern.polyNotes = out;
    } else {
      // Step mode: fill melody[] array
      for (let i = 0; i < len; i++) {
        const on = Math.random() < 0.35;
        seq.pattern.melody[i] = {
          on,
          notes: on ? [pickMidi()] : [60],
          accent: on && Math.random() < 0.2,
          tie: on && Math.random() < 0.1,
        };
      }
    }
  } else {
    const track = seq.pattern.extraPolyTracks.find((t) => t.id === laneId);
    if (!track) return;
    const out: NoteEvent[] = [];
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.3) {
        out.push({
          start: i * TICKS_PER_STEP,
          duration: TICKS_PER_STEP * (Math.random() < 0.3 ? 2 : 1),
          midi: pickMidi(),
          velocity: Math.random() < 0.25 ? 115 : 80,
        });
      }
    }
    track.notes = out;
  }

  deps.rebuildPolyTrack();
  deps.rebuildRollsView();
}

/** Wire all per-lane randomize buttons. Call once at boot. */
export function wireRandomizeUI(deps: RandomizeUIDeps): void {
  const $btn = (id: string) => document.getElementById(id) as HTMLButtonElement | null;

  $btn('bass-random-sound')?.addEventListener('click', () => randomizeBassSound(deps));
  $btn('bass-random-notes')?.addEventListener('click', () => randomizeBassNotes(deps));
  $btn('drums-random')?.addEventListener('click', () => randomizeDrumsLane(deps));
  $btn('poly-random-notes')?.addEventListener('click', () =>
    randomizePolyLaneNotes(deps, deps.getActiveEngineLaneId()),
  );
}
