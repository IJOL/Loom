// Pure: turn the backend's /transcribe response (note times in SECONDS) into a
// note-lane plan (NoteEvent[] in ticks at the session bpm) for a melodic
// (Subtractive) or drums (drums-machine) lane.

import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import { ticksPerBar, type TimeSignature } from '../core/meter';
import { VOICE_MIDI } from '../engines/drum-gm-map';

export interface TranscribeMelodicNote { start: number; dur: number; midi: number; velocity: number; }
export interface TranscribeDrumNote { start: number; voice: string; velocity: number; }

export interface TranscribeResult {
  kind: 'melodic' | 'drums';
  tempo: number | null;
  notes: TranscribeMelodicNote[] | TranscribeDrumNote[];
}

export interface NoteLanePlan {
  engineId: 'subtractive' | 'drums-machine';
  notes: NoteEvent[];
  lengthBars: number;
}

const clampVel = (v: number) => Math.max(1, Math.min(127, Math.round(v || 80)));

/** Map detected notes (seconds) onto the session grid (ticks at `bpm`). */
export function transcribeToNoteLane(
  result: TranscribeResult,
  bpm: number,
  meter: TimeSignature,
): NoteLanePlan {
  const secToTicks = (s: number) => Math.max(0, Math.round((s * bpm * TICKS_PER_QUARTER) / 60));

  let engineId: NoteLanePlan['engineId'];
  let notes: NoteEvent[];

  if (result.kind === 'drums') {
    engineId = 'drums-machine';
    const sixteenth = Math.max(1, Math.round(TICKS_PER_QUARTER / 4)); // one step
    notes = (result.notes as TranscribeDrumNote[]).map((n) => ({
      start: secToTicks(n.start),
      duration: sixteenth,
      midi: VOICE_MIDI[n.voice as keyof typeof VOICE_MIDI] ?? VOICE_MIDI.closedHat,
      velocity: clampVel(n.velocity),
    }));
  } else {
    engineId = 'subtractive';
    notes = (result.notes as TranscribeMelodicNote[]).map((n) => ({
      start: secToTicks(n.start),
      duration: Math.max(1, secToTicks(n.dur)),
      midi: n.midi,
      velocity: clampVel(n.velocity),
    }));
  }

  const barTicks = ticksPerBar(meter);
  const maxEnd = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const lengthBars = Math.max(1, Math.ceil(maxEnd / barTicks));
  return { engineId, notes, lengthBars };
}
