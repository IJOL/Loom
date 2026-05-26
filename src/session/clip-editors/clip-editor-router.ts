// src/session/clip-editors/clip-editor-router.ts
// Detects the kind of clip and dispatches to the appropriate editor renderer.

import type { SessionClip, SessionLane } from '../session';
import type { Sequencer } from '../../core/sequencer';
import type { LanePlayState } from '../session-runtime';
import { createPianoRoll, type PianoRollHandle } from '../../core/pianoroll';
import { TICKS_PER_STEP, type NoteEvent, bassStepsToNotes, stepsToNotes } from '../../core/notes';
import { renderDrumBusEditor } from './clip-editor-drum-bus';
import { renderDrumLaneEditor } from './clip-editor-drum-lane';

export interface ClipEditorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  laneStates: Map<string, LanePlayState>;
  midiLabel: (m: number) => string;
}

/** Renders the appropriate editor into `host`, returns piano-roll handle if created (else null). */
export function renderClipEditor(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
): PianoRollHandle | null {
  host.innerHTML = '';

  // ── Drum-bus ──────────────────────────────────────────────────────────────
  if (lane.kind === 'drum-bus' && clip.drumSteps) {
    renderDrumBusEditor(host, clip);
    return null;
  }

  // ── Drum-lane ─────────────────────────────────────────────────────────────
  if (lane.kind === 'drum-lane' && clip.drumLane && clip.drumLaneSteps) {
    renderDrumLaneEditor(host, clip);
    return null;
  }

  // ── Bass: always piano-roll. Convert legacy step data on the fly. ─────────
  if (lane.kind === 'bass') {
    if ((!clip.bassNotes || clip.bassNotes.length === 0) && clip.bassSteps && clip.bassSteps.length) {
      clip.bassNotes = bassStepsToNotes(clip.bassSteps);
    }
    clip.bassMode = 'piano';
    delete clip.bassSteps;
    return buildPianoRoll(host, lane, clip, deps, true);
  }

  // ── Poly: always piano-roll. Convert legacy step data on the fly. ─────────
  if (lane.kind === 'poly') {
    if ((!clip.polyNotes || clip.polyNotes.length === 0) && clip.polySteps && clip.polySteps.length) {
      clip.polyNotes = stepsToNotes(clip.polySteps);
    }
    clip.polyMode = 'piano';
    delete clip.polySteps;
    return buildPianoRoll(host, lane, clip, deps, false);
  }

  // Fallback: nothing to render
  const msg = document.createElement('p');
  msg.style.cssText = 'color:#888;font-size:12px;padding:8px';
  msg.textContent = 'No editor available for this clip type.';
  host.appendChild(msg);
  return null;
}

function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  isBass: boolean,
): PianoRollHandle {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(800, clip.lengthBars * 240);
  canvas.height = 240;
  canvas.style.height = '240px';
  canvas.style.width = `${canvas.width}px`;
  host.appendChild(canvas);

  const getNotes = (): NoteEvent[] => isBass ? (clip.bassNotes ?? []) : (clip.polyNotes ?? []);
  const setNotes = (notes: NoteEvent[]) => {
    if (isBass) clip.bassNotes = notes;
    else        clip.polyNotes = notes;
  };

  const { ctx, seq, laneStates } = deps;
  return createPianoRoll({
    canvas,
    getNotes,
    setNotes,
    patternTicks: clip.lengthBars * 16 * TICKS_PER_STEP,
    minMidi: isBass ? 24 : 36,
    maxMidi: isBass ? 60 : 96,
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
  });
}
