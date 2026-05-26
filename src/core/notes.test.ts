import { describe, it, expect } from 'vitest';
import {
  bassStepsToNotes, stepsToNotes, drumStepsToNotes, drumLaneToNotes,
  TICKS_PER_STEP,
} from './notes';
import { VOICE_MIDI } from '../engines/drum-gm-map';
import type { BassStep, PolyStep, DrumStep } from './sequencer';

describe('bassStepsToNotes', () => {
  it('skips off steps and converts on steps to NoteEvent[]', () => {
    const steps: BassStep[] = [
      { on: true,  note: 36, accent: false, slide: false },
      { on: false, note: 0,  accent: false, slide: false },
      { on: true,  note: 40, accent: true,  slide: false },
    ];
    const notes = bassStepsToNotes(steps);
    expect(notes).toHaveLength(2);
    expect(notes[0].midi).toBe(36);
    expect(notes[0].start).toBe(0);
    expect(notes[1].midi).toBe(40);
    expect(notes[1].start).toBe(2 * TICKS_PER_STEP);
    expect(notes[1].velocity).toBeGreaterThanOrEqual(100);  // accent
  });

  it('extends slide step duration past 1 step', () => {
    const steps: BassStep[] = [{ on: true, note: 36, accent: false, slide: true }];
    const notes = bassStepsToNotes(steps);
    expect(notes[0].duration).toBeGreaterThan(TICKS_PER_STEP);
  });
});

describe('stepsToNotes (poly melody)', () => {
  it('expands each chord note into its own NoteEvent', () => {
    const steps: PolyStep[] = [
      { on: true, notes: [60, 64, 67], accent: false, tie: false },
    ];
    const notes = stepsToNotes(steps);
    expect(notes.map((n) => n.midi).sort()).toEqual([60, 64, 67]);
    expect(notes.every((n) => n.start === 0)).toBe(true);
  });

  it('marks accent as velocity >= 100', () => {
    const steps: PolyStep[] = [{ on: true, notes: [60], accent: true, tie: false }];
    expect(stepsToNotes(steps)[0].velocity).toBeGreaterThanOrEqual(100);
  });
});

describe('drumStepsToNotes', () => {
  it('uses VOICE_MIDI for each voice and one note per active step', () => {
    const kick: DrumStep[] = [
      { on: true, accent: false }, { on: false, accent: false },
      { on: true, accent: true  }, { on: false, accent: false },
    ];
    const snare: DrumStep[] = [
      { on: false, accent: false }, { on: true, accent: false },
      { on: false, accent: false }, { on: true, accent: false },
    ];
    const notes = drumStepsToNotes({ kick, snare });
    const kicks  = notes.filter((n) => n.midi === VOICE_MIDI.kick);
    const snares = notes.filter((n) => n.midi === VOICE_MIDI.snare);
    expect(kicks).toHaveLength(2);
    expect(snares).toHaveLength(2);
    expect(kicks.find((n) => n.start === 2 * TICKS_PER_STEP)!.velocity).toBeGreaterThanOrEqual(100);
  });

  it('expands roll factor into N sub-step notes', () => {
    const steps: DrumStep[] = [{ on: true, accent: false, roll: 4 }];
    const notes = drumLaneToNotes('kick', steps);
    expect(notes).toHaveLength(4);
    const starts = notes.map((n) => n.start);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeGreaterThan(0);
    expect(starts[3]).toBeLessThan(TICKS_PER_STEP);
  });

  it('skips voices not in VOICE_MIDI (defensive)', () => {
    // @ts-expect-error — testing defensive behaviour with unknown voice
    const notes = drumStepsToNotes({ thisIsNotAVoice: [{ on: true, accent: false }] });
    expect(notes).toHaveLength(0);
  });
});
