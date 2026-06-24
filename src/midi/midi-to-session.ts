import type { ParsedMidi } from './midi-parse';
import { CLIP_COLOR_PALETTE, type SessionLane, type SessionClip, type SessionScene } from '../session/session';
import type { NoteEvent } from '../core/notes';
import { TICKS_PER_STEP } from '../core/notes';
import { findGMMatches, isPercussionTrack, type GMMatch } from './gm-lookup';
import { planDrumLanes } from './percussion-split';

/** The bundled GM Percussion kit id (public/drumkits/gm-percussion.json). */
const GM_PERCUSSION_KIT = 'gm-percussion';

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

  const convert = (n: { startTick: number; duration: number; midi: number; velocity: number }): NoteEvent => ({
    start: Math.round((n.startTick - globalMinStart) * scale),
    duration: Math.max(6, Math.round(n.duration * scale)),
    midi: n.midi,
    velocity: n.velocity,
  });

  // Create a lane (+ its single clip at sceneRow). Colour rotates by lane index so
  // adjacent imported lanes differ; without a colour the cell text is unreadable.
  const pushLane = (notes: NoteEvent[], clipName: string, laneProps: Partial<SessionLane> & { engineId: string }): void => {
    const clip: SessionClip = {
      id: nextId('clip'),
      name: clipName,
      color: CLIP_COLOR_PALETTE[newLanes.length % CLIP_COLOR_PALETTE.length],
      lengthBars,
      notes,
    };
    const clips: (SessionClip | null)[] =
      sceneRow > 0 ? [...Array<SessionClip | null>(sceneRow).fill(null), clip] : [clip];
    const lane: SessionLane = { id: nextId('lane'), clips, ...laneProps };
    newLanes.push(lane);
    clipPerLane[lane.id] = sceneRow;
  };

  for (const tr of selected) {
    const clipNotes = tr.notes.map(convert);

    // Percussion (channel 10) tracks are split: standard kit notes (kick/snare/
    // hats/toms/cymbals) → a normal Drums lane; GM-percussion notes (shaker/
    // tambourine/congas…) → a separate Drums lane on the GM Percussion sample kit.
    if (isPercussionTrack(tr)) {
      const plan = planDrumLanes(clipNotes);
      if (plan.drum) {
        pushLane(plan.drum, tr.name || 'Drums', { engineId: 'drums-machine', name: 'Drums' });
      }
      if (plan.perc) {
        pushLane(plan.perc, 'Percussion', {
          engineId: 'drums-machine',
          name: 'Percussion',
          // Sample-kit Drums lane: kitMode 'sample' + the GM Percussion kit. The
          // import apply step (main.ts launchSceneById) loads it via applyDrumPreset.
          engineState: { kitMode: 'sample', sampler: { keymap: [], drumkitId: GM_PERCUSSION_KIT } },
          enginePresetName: 'engine:GM Percussion',
        });
      }
      continue;
    }

    // Melodic track → normal engine/preset by GM program (name no longer forces drums).
    const prog = tr.program < 0 ? 0 : tr.program;
    const match = opts.presetPerTrack[tr.index] ?? { engineId: 'poly', presetName: 'Init' };
    if (findGMMatches(prog).length === 0) unmatchedTracks.push({ name: tr.name, program: prog });
    pushLane(clipNotes, tr.name || `Track ${tr.index}`, {
      engineId: match.engineId,
      name: match.presetName,
      enginePresetName: `factory:${match.presetName}`,
    });
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
