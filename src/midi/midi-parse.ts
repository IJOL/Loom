// src/midi/midi-parse.ts (stub — full implementation lands in Task E1)
export interface ParsedTrack {
  index: number;
  name: string;
  program: number;
  notes: { startTick: number; duration: number; midi: number; velocity: number; channel: number }[];
}

export interface ParsedMidi {
  division: number;
  bpm: number | null;
  tracks: ParsedTrack[];
}
