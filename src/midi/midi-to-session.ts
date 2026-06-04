import type { ParsedMidi } from './midi-parse';
import type { SessionLane, SessionClip, SessionScene } from '../session/session';
import type { NoteEvent } from '../core/notes';
import { TICKS_PER_STEP } from '../core/notes';
import { findGMMatches, type GMMatch } from './gm-lookup';

export interface MidiImportResult {
  newLanes: SessionLane[];
  scene: SessionScene;
  bpm: number | null;
  unmatchedTracks: { name: string; program: number }[];
}

const TICKS_PER_BAR = TICKS_PER_STEP * 16;

let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function midiToSession(
  parsed: ParsedMidi,
  opts: {
    selectedTrackIndices: number[];
    presetPerTrack: Record<number, GMMatch>;
    /** Clip-slot/row this import's scene occupies. The grid couples row r ↔
     *  scene r ↔ clip slot r, so a scene appended at index N must place its
     *  clips at slot N to render on the same row as its launch button. Default
     *  0 (a fresh/Replace session whose only scene is row 0). */
    sceneRow?: number;
  },
): MidiImportResult {
  const sceneRow = Math.max(0, Math.floor(opts.sceneRow ?? 0));
  const selected = parsed.tracks.filter((t) => opts.selectedTrackIndices.includes(t.index));
  const scale = (TICKS_PER_STEP * 4) / parsed.division;

  let globalMinStart = Infinity;
  let globalMaxEnd = 0;
  for (const tr of selected) for (const n of tr.notes) {
    if (n.startTick < globalMinStart) globalMinStart = n.startTick;
    const end = n.startTick + n.duration;
    if (end > globalMaxEnd) globalMaxEnd = end;
  }
  if (!isFinite(globalMinStart)) globalMinStart = 0;

  const songTicks = Math.ceil((globalMaxEnd - globalMinStart) * scale);
  const lengthBars = Math.max(1, Math.ceil(songTicks / TICKS_PER_BAR));

  const newLanes: SessionLane[] = [];
  const clipPerLane: Record<string, number | null> = {};
  const unmatchedTracks: { name: string; program: number }[] = [];

  for (const tr of selected) {
    const prog = tr.program < 0 ? 0 : tr.program;
    const match = opts.presetPerTrack[tr.index] ?? { engineId: 'poly', presetName: 'Init' };
    if (findGMMatches(prog).length === 0) unmatchedTracks.push({ name: tr.name, program: prog });

    const clipNotes: NoteEvent[] = tr.notes
      .map((n) => ({
        start: Math.round((n.startTick - globalMinStart) * scale),
        duration: Math.max(6, Math.round(n.duration * scale)),
        midi: n.midi,
        velocity: n.velocity,
      }));

    const clip: SessionClip = {
      id: nextId('clip'),
      name: tr.name || `Track ${tr.index}`,
      lengthBars,
      notes: clipNotes,
    };
    // Pad with empty slots so the clip sits at `sceneRow`, aligning with the
    // scene's launch button (otherwise imported clips pile into row 0).
    const clips: (SessionClip | null)[] =
      sceneRow > 0 ? [...Array<SessionClip | null>(sceneRow).fill(null), clip] : [clip];
    const lane: SessionLane = {
      id: nextId('lane'),
      engineId: match.engineId,
      name: tr.name || `Track ${tr.index}`,
      clips,
      enginePresetName: `factory:${match.presetName}`,
    };
    newLanes.push(lane);
    clipPerLane[lane.id] = sceneRow;
  }

  const scene: SessionScene = {
    id: nextId('scene'),
    name: 'MIDI Import',
    clipPerLane,
  };

  return {
    newLanes, scene,
    bpm: parsed.bpm,
    unmatchedTracks,
  };
}
