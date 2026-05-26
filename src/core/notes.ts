// Time-based note events for the polysynth track piano roll. Uses ticks at
// TICKS_PER_QUARTER resolution so notes can sit anywhere, not just on 16th
// boundaries. Conversion to/from step-based PolyStep is one-way (lossy in
// the piano → step direction; lossless step → piano).

import type { PolyStep, BassStep, DrumStep } from './sequencer';
import type { DrumVoice } from './drums';
import { VOICE_MIDI } from '../engines/drum-gm-map';

export const TICKS_PER_QUARTER = 96;
export const TICKS_PER_STEP    = TICKS_PER_QUARTER / 4; // 24 (one 16th)

export interface NoteEvent {
  start: number;     // ticks from pattern start
  duration: number;  // ticks (min 1, snap suggested to TICKS_PER_STEP/2)
  midi: number;      // 0-127
  velocity: number;  // 0-127 (>= 100 = accent)
}

// Convert step-based melody to free note events (used when first switching
// a track from STEP to PIANO mode so the user doesn't lose work).
export function stepsToNotes(melody: PolyStep[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < melody.length; i++) {
    const s = melody[i];
    if (!s.on || s.notes.length === 0) continue;
    const dur = Math.floor(TICKS_PER_STEP * (s.tie ? 1.6 : 0.9));
    const velocity = s.accent ? 115 : 80;
    for (const m of s.notes) {
      out.push({ start: i * TICKS_PER_STEP, duration: dur, midi: m, velocity });
    }
  }
  return out;
}

// Convert TB-303 step-based bass to free note events. Slide steps overlap into
// the next step so the piano-roll representation triggers the same "sliding in"
// behavior when the next note starts.
export function bassStepsToNotes(bass: BassStep[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < bass.length; i++) {
    const s = bass[i];
    if (!s.on) continue;
    const dur = Math.floor(TICKS_PER_STEP * (s.slide ? 1.5 : 0.92));
    out.push({
      start: i * TICKS_PER_STEP,
      duration: dur,
      midi: s.note,
      velocity: s.accent ? 115 : 80,
    });
  }
  return out;
}

// Convert NoteEvent[] back to BassStep[] for the TB-303 step grid.
// Lossy: quantizes to 16ths, mono (last note wins on collision), slide when a
// note's end reaches into the next step.
export function notesToBassSteps(notes: NoteEvent[], length: number): BassStep[] {
  const out: BassStep[] = Array.from({ length }, () => ({ on: false, note: 36, accent: false, slide: false }));
  for (const n of notes) {
    const stepIdx = Math.floor(n.start / TICKS_PER_STEP);
    if (stepIdx < 0 || stepIdx >= length) continue;
    const slide = (n.start + n.duration) > (stepIdx + 1) * TICKS_PER_STEP + 1;
    out[stepIdx] = {
      on: true,
      note: Math.max(0, Math.min(127, n.midi)),
      accent: n.velocity >= 100,
      slide,
    };
  }
  return out;
}

// Convert NoteEvent[] to step-based PolyStep[]. Polyphonic: notes that fall on
// the same quantized step are collected. Tie = any note longer than ~1 step.
export function notesToPolySteps(notes: NoteEvent[], length: number): PolyStep[] {
  const out: PolyStep[] = Array.from({ length }, () => ({ on: false, notes: [60], accent: false, tie: false }));
  for (const n of notes) {
    const stepIdx = Math.floor(n.start / TICKS_PER_STEP);
    if (stepIdx < 0 || stepIdx >= length) continue;
    const s = out[stepIdx];
    if (!s.on) { s.on = true; s.notes = []; }
    if (!s.notes.includes(n.midi)) s.notes.push(n.midi);
    if (n.velocity >= 100) s.accent = true;
    if (n.duration > TICKS_PER_STEP * 1.2) s.tie = true;
  }
  for (const s of out) if (s.on && s.notes.length === 0) s.notes = [60];
  return out;
}

export function patternTicks(steps: number): number {
  return steps * TICKS_PER_STEP;
}

// Convert a drum-bus step grid (Record<DrumVoice, DrumStep[]>) into a flat
// note-event list using each voice's canonical GM midi. Roll factors expand
// into multiple closely-spaced notes.
export function drumStepsToNotes(steps: Partial<Record<DrumVoice, DrumStep[]>>): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const [voice, arr] of Object.entries(steps) as Array<[DrumVoice, DrumStep[] | undefined]>) {
    if (!arr) continue;
    const midi = VOICE_MIDI[voice];
    if (midi == null) continue;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!s || !s.on) continue;
      const div = s.roll && s.roll > 1 ? s.roll : 1;
      const subDur = TICKS_PER_STEP / div;
      for (let r = 0; r < div; r++) {
        out.push({
          midi,
          start: i * TICKS_PER_STEP + Math.floor(r * subDur),
          duration: Math.max(1, Math.floor(subDur * 0.9)),
          velocity: s.accent ? 115 : 80,
        });
      }
    }
  }
  return out;
}

// Convert a single drum-lane (DrumVoice + DrumStep[]) to notes.
export function drumLaneToNotes(voice: DrumVoice, steps: DrumStep[]): NoteEvent[] {
  return drumStepsToNotes({ [voice]: steps } as Partial<Record<DrumVoice, DrumStep[]>>);
}
