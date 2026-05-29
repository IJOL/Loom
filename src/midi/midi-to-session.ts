import type { ParsedMidi } from './midi-parse';
import type { SessionLane, SessionClip, SessionScene } from '../session/session';
import type { NoteEvent } from '../core/notes';
import { TICKS_PER_STEP } from '../core/notes';
import { findGMMatches, type GMMatch } from './gm-lookup';

export interface MidiImportResult {
  newLanes: SessionLane[];
  scene: SessionScene;
  bpm: number | null;
  drumClip: SessionClip | null;
  drumKitMatch: GMMatch | null;
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
    drumKitMatch: GMMatch | null;
  },
): MidiImportResult {
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
  const presetPerLane: Record<string, string> = {};
  const unmatchedTracks: { name: string; program: number }[] = [];

  const drumNotes: NoteEvent[] = [];

  for (const tr of selected) {
    const isDrum = tr.notes.some((n) => n.channel === 9);
    if (isDrum) {
      for (const n of tr.notes) if (n.channel === 9) {
        drumNotes.push({
          start: Math.round((n.startTick - globalMinStart) * scale),
          duration: Math.max(6, Math.round(n.duration * scale)),
          midi: n.midi,
          velocity: n.velocity,
        });
      }
      continue;
    }

    const prog = tr.program < 0 ? 0 : tr.program;
    const match = opts.presetPerTrack[tr.index] ?? { engineId: 'poly', presetName: 'Init' };
    if (findGMMatches(prog).length === 0) unmatchedTracks.push({ name: tr.name, program: prog });

    const clipNotes: NoteEvent[] = tr.notes
      .filter((n) => n.channel !== 9)
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
    const lane: SessionLane = {
      id: nextId('lane'),
      engineId: match.engineId,
      name: tr.name || `Track ${tr.index}`,
      clips: [clip],
      enginePresetName: `factory:${match.presetName}`,
    };
    newLanes.push(lane);
    clipPerLane[lane.id] = 0;
    presetPerLane[lane.id] = `factory:${match.presetName}`;
  }

  const drumClip: SessionClip | null = drumNotes.length === 0 ? null : {
    id: nextId('clip'),
    name: 'MIDI Drums',
    lengthBars,
    notes: drumNotes,
  };

  const scene: SessionScene = {
    id: nextId('scene'),
    name: 'MIDI Import',
    clipPerLane,
    presetPerLane,
  };

  return {
    newLanes, scene,
    bpm: parsed.bpm,
    drumClip,
    drumKitMatch: opts.drumKitMatch,
    unmatchedTracks,
  };
}
