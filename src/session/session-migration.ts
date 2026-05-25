// One-shot Classic → Session importer. Reads the current PatternBank and
// builds a fresh SessionState with one scene per slot, one clip per
// (lane, slot) pair.

import type { PatternBank, PatternData } from '../core/pattern';
import {
  emptyLane, emptyScene, emptySessionState,
  type SessionClip, type SessionLane, type SessionState,
} from './session';
import { DRUM_LANES, type DrumVoice } from '../core/drums';
import type { DrumStep } from '../core/sequencer';

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clipFromBass(pat: PatternData): SessionClip {
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    bassSteps: pat.bass.map((s) => ({ ...s })),
    bassNotes: (pat.bassNotes ?? []).map((n) => ({ ...n })),
    bassMode: pat.bassMode ?? 'step',
  };
}

function clipFromDrums(pat: PatternData): SessionClip {
  const drumSteps: Record<DrumVoice, DrumStep[]> = {} as Record<DrumVoice, DrumStep[]>;
  for (const lane of DRUM_LANES) {
    drumSteps[lane] = (pat.drums[lane] ?? []).map((s) => ({ ...s }));
  }
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    drumSteps,
  };
}

function clipFromMainPoly(pat: PatternData): SessionClip {
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    polySteps: pat.melody.map((s) => ({ ...s, notes: [...s.notes] })),
    polyNotes: (pat.polyNotes ?? []).map((n) => ({ ...n })),
    polyMode: pat.polyMode ?? 'step',
  };
}

function clipFromExtra(pat: PatternData, extraId: string): SessionClip | null {
  const track = (pat.extraPolyTracks ?? []).find((t) => t.id === extraId);
  if (!track) return null;
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    polyMode: 'piano',
    polyNotes: track.notes.map((n) => ({ ...n })),
  };
}

export function importClassicToSession(bank: PatternBank): SessionState {
  const state = emptySessionState();

  // Collect the union of extra-poly ids used across all slots.
  const extraIds = new Set<string>();
  for (const slot of bank.slots) {
    for (const t of slot.extraPolyTracks ?? []) extraIds.add(t.id);
  }
  for (const id of extraIds) {
    state.lanes.push(emptyLane(id, 'poly'));
  }

  // For every slot, create a scene + one clip per lane.
  bank.slots.forEach((pat, slotIdx) => {
    const scene = emptyScene(`Scene ${slotIdx + 1}`);
    state.scenes.push(scene);

    const bassLane  = state.lanes.find((l) => l.id === 'bass')!;
    const drumsLane = state.lanes.find((l) => l.id === 'drums')!;
    const mainLane  = state.lanes.find((l) => l.id === 'main')!;

    const pushClip = (lane: SessionLane, clip: SessionClip | null): number | null => {
      if (!clip) return null;
      while (lane.clips.length < slotIdx) lane.clips.push(null);
      lane.clips[slotIdx] = clip;
      return slotIdx;
    };

    scene.clipPerLane.bass  = pushClip(bassLane,  clipFromBass(pat));
    scene.clipPerLane.drums = pushClip(drumsLane, clipFromDrums(pat));
    scene.clipPerLane.main  = pushClip(mainLane,  clipFromMainPoly(pat));
    for (const id of extraIds) {
      const lane = state.lanes.find((l) => l.id === id);
      if (lane) scene.clipPerLane[id] = pushClip(lane, clipFromExtra(pat, id));
    }
  });

  // Normalise: pad every lane to scenes.length so the grid renders uniformly.
  for (const lane of state.lanes) {
    while (lane.clips.length < state.scenes.length) lane.clips.push(null);
  }

  return state;
}

export function expandDrumsLane(state: SessionState): void {
  const drums = state.lanes.find((l) => l.id === 'drums');
  if (!drums || drums.expanded) return;
  drums.expanded = true;

  const subLanes = DRUM_LANES.map((d) => emptyLane(`drum:${d}`, 'drum-lane'));
  drums.clips.forEach((clip, rowIdx) => {
    if (!clip || !clip.drumSteps) {
      for (const sl of subLanes) {
        while (sl.clips.length <= rowIdx) sl.clips.push(null);
        sl.clips[rowIdx] = null;
      }
      return;
    }
    for (let i = 0; i < subLanes.length; i++) {
      const drumLane = DRUM_LANES[i];
      const steps = clip.drumSteps[drumLane] ?? [];
      while (subLanes[i].clips.length <= rowIdx) subLanes[i].clips.push(null);
      subLanes[i].clips[rowIdx] = {
        id: `clip-${Date.now().toString(36)}-${i}-${rowIdx}`,
        name: clip.name,
        lengthBars: clip.lengthBars,
        drumLane,
        drumLaneSteps: steps.map((s) => ({ ...s })),
      };
    }
  });

  const idx = state.lanes.indexOf(drums);
  state.lanes.splice(idx + 1, 0, ...subLanes);
  for (const scene of state.scenes) {
    const row = scene.clipPerLane.drums;
    delete scene.clipPerLane.drums;
    for (const sl of subLanes) scene.clipPerLane[sl.id] = row ?? null;
  }
}

export function collapseDrumsLane(state: SessionState): void {
  const drums = state.lanes.find((l) => l.id === 'drums');
  if (!drums || !drums.expanded) return;
  drums.expanded = false;

  const subLanes = DRUM_LANES.map((d) => state.lanes.find((l) => l.id === `drum:${d}`)).filter(Boolean) as SessionLane[];

  const rowCount = Math.max(0, ...subLanes.map((l) => l.clips.length));
  drums.clips = Array.from({ length: rowCount }, (_, rowIdx) => {
    const subClips = subLanes.map((l) => l.clips[rowIdx]).filter(Boolean) as SessionClip[];
    if (subClips.length === 0) return null;
    const lengthBars = Math.max(1, ...subClips.map((c) => c.lengthBars));
    const drumSteps: Record<DrumVoice, DrumStep[]> = {} as Record<DrumVoice, DrumStep[]>;
    for (let i = 0; i < DRUM_LANES.length; i++) {
      const drumLane = DRUM_LANES[i];
      const c = subLanes[i].clips[rowIdx];
      drumSteps[drumLane] = c?.drumLaneSteps?.map((s) => ({ ...s })) ?? Array.from({ length: lengthBars * 16 }, () => ({ on: false, accent: false }));
    }
    return {
      id: `clip-${Date.now().toString(36)}-bus-${rowIdx}`,
      lengthBars,
      drumSteps,
    };
  });

  for (const sl of subLanes) {
    const i = state.lanes.indexOf(sl);
    if (i >= 0) state.lanes.splice(i, 1);
  }
  for (const scene of state.scenes) {
    for (const sl of subLanes) delete scene.clipPerLane[sl.id];
    scene.clipPerLane.drums = scene.clipPerLane.drums ?? null;
  }
}
