// Per-clip note randomization. Writes random notes into clip.notes based on
// the lane's engineId. Bass-like engines (tb303) get a single-line monophonic
// sequence; drum engines get GM-mapped beats biased to musical positions;
// poly engines get sparse melodic notes inside a scale.

import type { SessionClip, SessionLane } from './session';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { stepsPerBar, DEFAULT_METER, type TimeSignature } from '../core/meter';

const SCALE_INTERVALS: Record<string, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export interface ClipRandomizeOpts {
  scale: string;
  rootMidi: number;
  /** Editor's selected octave base (the ◂ C4 ▸ stepper; MIDI of the lowest
   *  on-screen key). Notes are placed relative to this so randomize follows the
   *  selected octave instead of a fixed register. Absent ⇒ C4 (60). */
  octaveBase?: number;
}

const GM_DRUMS = {
  kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39, cowbell: 56,
} as const;

function pickInScale(opts: ClipRandomizeOpts, octaveRange: number, baseMidi: number): number {
  const intervals = SCALE_INTERVALS[opts.scale] ?? SCALE_INTERVALS.pentMinor;
  const oct = Math.floor(Math.random() * octaveRange);
  const iv  = intervals[Math.floor(Math.random() * intervals.length)];
  return baseMidi + oct * 12 + iv;
}

function bassNotes(opts: ClipRandomizeOpts, steps: number, baseMidi: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < steps; i++) {
    if (Math.random() >= 0.5) continue;
    out.push({
      start: i * TICKS_PER_STEP,
      duration: TICKS_PER_STEP,
      midi: pickInScale(opts, 2, baseMidi),
      velocity: Math.random() < 0.25 ? 115 : 80,
    });
  }
  return out;
}

function polyNotes(opts: ClipRandomizeOpts, steps: number, baseMidi: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < steps; i++) {
    if (Math.random() >= 0.3) continue;
    out.push({
      start: i * TICKS_PER_STEP,
      duration: TICKS_PER_STEP * (Math.random() < 0.3 ? 2 : 1),
      midi: pickInScale(opts, 2, baseMidi),
      velocity: Math.random() < 0.25 ? 115 : 80,
    });
  }
  return out;
}

function drumNotes(clip: SessionClip, steps: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < steps; i++) {
    const onDownbeat = i % 4 === 0;
    const onBackbeat = i % 8 === 4;
    if (onDownbeat && Math.random() < 0.85) {
      out.push({ start: i * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi: GM_DRUMS.kick, velocity: 110 });
    }
    if (onBackbeat && Math.random() < 0.75) {
      out.push({ start: i * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi: GM_DRUMS.snare, velocity: 100 });
    }
    if (Math.random() < 0.6) {
      const hat = Math.random() < 0.15 ? GM_DRUMS.openHat : GM_DRUMS.closedHat;
      out.push({ start: i * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi: hat, velocity: 70 });
    }
    if (Math.random() < 0.08) {
      out.push({ start: i * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi: GM_DRUMS.clap, velocity: 90 });
    }
  }
  return out;
}

export function randomizeClipNotes(
  clip: SessionClip,
  lane: SessionLane,
  opts: ClipRandomizeOpts,
  meter: TimeSignature = DEFAULT_METER,
): void {
  const steps = clip.lengthBars * stepsPerBar(meter);
  const octaveBase = opts.octaveBase ?? 60;            // editor ◂ C4 ▸ (default C4)
  const pc = (((opts.rootMidi ?? 0) % 12) + 12) % 12;  // key pitch class
  if (lane.engineId === 'tb303') clip.notes = bassNotes(opts, steps, octaveBase - 12 + pc);
  else if (lane.engineId === 'drums-machine') clip.notes = drumNotes(clip, steps);
  else clip.notes = polyNotes(opts, steps, octaveBase + pc);
}
