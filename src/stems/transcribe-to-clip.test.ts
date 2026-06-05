import { describe, it, expect } from 'vitest';
import { transcribeToNoteLane, type TranscribeResult } from './transcribe-to-clip';
import { DEFAULT_METER } from '../core/meter';
import { VOICE_MIDI } from '../engines/drum-gm-map';

// At 120 bpm: ticks = seconds * 120 * 96 / 60 = seconds * 192.
describe('transcribeToNoteLane', () => {
  it('maps melodic notes (seconds → ticks) onto a subtractive lane', () => {
    const result: TranscribeResult = {
      kind: 'melodic',
      tempo: 120,
      notes: [
        { start: 0, dur: 0.5, midi: 57, velocity: 65 },
        { start: 0.5, dur: 0.25, midi: 60, velocity: 200 }, // velocity clamps to 127
      ],
    };
    const plan = transcribeToNoteLane(result, 120, DEFAULT_METER);
    expect(plan.engineId).toBe('subtractive');
    expect(plan.notes[0]).toEqual({ start: 0, duration: 96, midi: 57, velocity: 65 });
    expect(plan.notes[1]).toEqual({ start: 96, duration: 48, midi: 60, velocity: 127 });
    expect(plan.lengthBars).toBe(1); // maxEnd 144 ticks < 384 (one 4/4 bar)
  });

  it('maps drum hits to the drums-machine lane with GM voice midis', () => {
    const result: TranscribeResult = {
      kind: 'drums',
      tempo: 120,
      notes: [
        { start: 0, voice: 'kick', velocity: 110 },
        { start: 0.25, voice: 'snare', velocity: 90 },
        { start: 0.5, voice: 'closedHat', velocity: 70 },
        { start: 0.75, voice: 'mystery', velocity: 70 }, // unknown → closedHat fallback
      ],
    };
    const plan = transcribeToNoteLane(result, 120, DEFAULT_METER);
    expect(plan.engineId).toBe('drums-machine');
    expect(plan.notes.map((n) => n.midi)).toEqual([
      VOICE_MIDI.kick, VOICE_MIDI.snare, VOICE_MIDI.closedHat, VOICE_MIDI.closedHat,
    ]);
    expect(plan.notes[0].start).toBe(0);
    expect(plan.notes[1].start).toBe(48);
    expect(plan.notes.every((n) => n.duration === 24)).toBe(true); // one 16th step
  });

  it('sizes lengthBars to fit the last note', () => {
    const result: TranscribeResult = {
      kind: 'melodic', tempo: null,
      notes: [{ start: 4, dur: 1, midi: 50, velocity: 80 }], // ends at 5s → 960 ticks
    };
    const plan = transcribeToNoteLane(result, 120, DEFAULT_METER);
    // 960 ticks / 384 ticks-per-bar = 2.5 → ceil = 3 bars
    expect(plan.lengthBars).toBe(3);
  });
});
