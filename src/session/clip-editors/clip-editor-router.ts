// src/session/clip-editors/clip-editor-router.ts
// Detects the engine assigned to the lane and dispatches to the matching
// editor (piano-roll or drum-grid). Falls back to piano-roll if engine has
// no explicit preference.

import type { SessionClip, SessionLane } from '../session';
import type { Sequencer } from '../../core/sequencer';
import type { LanePlayState } from '../session-runtime';
import { createPianoRoll, type PianoRollHandle } from '../../core/pianoroll';
import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';
import { getEngine } from '../../engines/registry';
import { renderDrumGridEditor } from './clip-editor-drum-grid';
import type { HistoryDeps } from '../../save/history-wiring';

export interface ClipEditorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  laneStates: Map<string, LanePlayState>;
  midiLabel: (m: number) => string;
  historyDeps?: HistoryDeps;
}

export function renderClipEditor(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  override?: 'piano-roll' | 'drum-grid',
): PianoRollHandle | null {
  host.innerHTML = '';
  const engine = getEngine(lane.engineId);
  const editor = override ?? engine?.editor ?? 'piano-roll';

  if (editor === 'drum-grid') {
    renderDrumGridEditor(host, clip, deps.historyDeps);
    return null;
  }
  return buildPianoRoll(host, lane, clip, deps);
}

function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
): PianoRollHandle {
  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(800, clip.lengthBars * 240);
  canvas.height = 240;
  canvas.style.height = '240px';
  canvas.style.width  = `${canvas.width}px`;
  // Wrap the canvas in a horizontally-scrollable container so very long clips
  // (e.g. a 152-bar MIDI import) don't blow out the page width. The host stays
  // pinned to the parent's width; the canvas scrolls inside it.
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'piano-roll-scroll';
  scrollWrap.style.overflowX = 'auto';
  scrollWrap.style.overflowY = 'hidden';
  scrollWrap.style.maxWidth = '100%';
  scrollWrap.appendChild(canvas);
  host.appendChild(scrollWrap);

  const getNotes = (): NoteEvent[] => clip.notes ?? [];
  const setNotes = (notes: NoteEvent[]) => { clip.notes = notes; };

  const isBassLikeEngine = lane.engineId === 'tb303';
  const { ctx, seq, laneStates, historyDeps } = deps;
  return createPianoRoll({
    canvas,
    scrollContainer: scrollWrap,
    getNotes,
    setNotes,
    patternTicks: clip.lengthBars * 16 * TICKS_PER_STEP,
    minMidi: isBassLikeEngine ? 24 : 36,
    maxMidi: isBassLikeEngine ? 60 : 96,
    onChange: () => {},
    getPlayheadTick: () => {
      const lp = laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const now = ctx.currentTime;
      const stepDur = 60 / seq.bpm / 4;
      const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * 16;
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    },
    ...(historyDeps ? {
      onGestureStart: () => historyDeps.history.beginGesture(historyDeps.snapshot()),
      onGestureEnd:   () => historyDeps.history.commitGesture(),
    } : {}),
  });
}
