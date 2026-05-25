import { DRUM_LANES, type DrumVoice } from './drums';
import type { BassStep, DrumStep, PolyStep } from './sequencer';
import type { NoteEvent } from './notes';

// Each automation lane is sampled at SUB_RES points per step, so a pattern of
// N steps has N * SUB_RES values. At 16 it's ~7ms resolution at 130 BPM — fine
// for filter sweeps without being too heavy on canvas redraws.
export const AUTOMATION_SUB_RES = 16;

export interface AutomationLane {
  paramId: string;        // matches an entry in main.ts automationRegistry
  enabled: boolean;
  stepped: boolean;       // when true, paints snap to step boundaries
  lengthBars: number;     // independent of pattern length — can be much longer
  values: number[];       // normalized 0..1; length === lengthBars * 16 * AUTOMATION_SUB_RES
}

export type PolyTrackMode = 'step' | 'piano';
export type BassMode = 'step' | 'piano';

export const MAX_EXTRA_POLY_TRACKS = 16;

export interface PolyTrack {
  id: string;                       // 'poly1' .. 'poly9'
  name: string;                     // display name (often from MIDI track name)
  notes: NoteEvent[];
  enabled: boolean;
  engineId?: string;                // 'subtractive' | 'wavetable' | 'fm' | ...  (default 'subtractive')
  // engineState reserved for Phase 1D serialization of engine knob values
}

export interface PatternData {
  length: number;
  bass: BassStep[];
  bassNotes: NoteEvent[];           // used when bassMode === 'piano'
  bassMode: BassMode;
  drums: Record<DrumVoice, DrumStep[]>;
  melody: PolyStep[];               // used when polyMode === 'step' (main poly only)
  polyNotes: NoteEvent[];           // used when polyMode === 'piano' (main poly only)
  polyMode: PolyTrackMode;
  extraPolyTracks: PolyTrack[];     // additional polyphonic tracks for MIDI imports
  automation: AutomationLane[];
  engineId: string;           // which engine is active for the poly host
  engineStepData: unknown;    // engine-specific sequencer state (serialized)
}

export function emptyPattern(length: number): PatternData {
  return {
    length,
    bass: Array.from({ length }, () => ({ on: false, note: 36, accent: false, slide: false })),
    bassNotes: [],
    bassMode: 'step',
    drums: Object.fromEntries(
      DRUM_LANES.map((lane) => [
        lane,
        Array.from({ length }, () => ({ on: false, accent: false })),
      ]),
    ) as Record<DrumVoice, DrumStep[]>,
    melody: Array.from({ length }, () => ({ on: false, notes: [60], accent: false, tie: false })),
    polyNotes: [],
    polyMode: 'piano',
    extraPolyTracks: [],
    automation: [],
    engineId: 'subtractive',
    engineStepData: null,
  };
}

export function clonePattern(p: PatternData): PatternData {
  return {
    length: p.length,
    bass: p.bass.map((s) => ({ ...s })),
    bassNotes: (p.bassNotes ?? []).map((n) => ({ ...n })),
    bassMode: p.bassMode ?? 'step',
    drums: Object.fromEntries(
      DRUM_LANES.map((lane) => [lane, p.drums[lane].map((s) => ({ ...s }))]),
    ) as Record<DrumVoice, DrumStep[]>,
    melody: p.melody.map((s) => ({ ...s, notes: [...s.notes] })),
    polyNotes: (p.polyNotes ?? []).map((n) => ({ ...n })),
    polyMode: p.polyMode ?? 'step',
    extraPolyTracks: (p.extraPolyTracks ?? []).map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n })), engineId: t.engineId ?? 'subtractive' })),
    automation: (p.automation ?? []).map((l) => ({ ...l, values: [...l.values] })),
    engineId: p.engineId,
    engineStepData: p.engineStepData ? JSON.parse(JSON.stringify(p.engineStepData)) : null,
  };
}

export class PatternBank {
  slots: PatternData[];
  current = 0;

  constructor(initialLength: number, count = 4) {
    this.slots = Array.from({ length: count }, () => emptyPattern(initialLength));
  }
}
