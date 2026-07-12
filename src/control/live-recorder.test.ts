import { describe, it, expect } from 'vitest';
import { createLiveRecorder } from './live-recorder';
import type { NoteEvent } from '../core/notes';

const rec = () => createLiveRecorder();

describe('live-recorder', () => {
  it('pairs noteOn/noteOff into a NoteEvent stamped from posTicks', () => {
    const r = rec();
    let pos = 10;
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    r.noteOn(60, 100); pos = 34; r.noteOff(60);
    const { notes } = r.stop();
    expect(notes).toEqual([{ start: 10, duration: 24, midi: 60, velocity: 100 }]);
  });

  it('replace ignores existing notes; merge keeps them', () => {
    const existing: NoteEvent[] = [{ start: 0, duration: 12, midi: 48, velocity: 80 }];
    let pos = 0;
    const rep = rec();
    rep.start({ mode: 'replace', existingNotes: existing, clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    rep.noteOn(60, 90); pos = 24; rep.noteOff(60);
    expect(rep.stop().notes.map((n) => n.midi)).toEqual([60]);

    pos = 0;
    const mrg = rec();
    mrg.start({ mode: 'merge', existingNotes: existing, clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    mrg.noteOn(60, 90); pos = 24; mrg.noteOff(60);
    expect(mrg.stop().notes.map((n) => n.midi).sort()).toEqual([48, 60]);
  });

  it('clamps notes past an existing clip length', () => {
    let pos = 380;
    const r = rec();
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: 384, barTicks: 384, posTicks: () => pos });
    r.noteOn(60, 100); pos = 400; r.noteOff(60);
    const { notes, lengthTicks } = r.stop();
    expect(lengthTicks).toBe(384);
    expect(notes[0].start + notes[0].duration).toBeLessThanOrEqual(384);
  });

  it('rounds a NEW clip length up to the next bar', () => {
    let pos = 0;
    const r = rec();
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: null, barTicks: 384, posTicks: () => pos });
    r.noteOn(60, 100); pos = 500; r.noteOff(60); // 500 ticks → 2 bars (768)
    expect(r.stop().lengthTicks).toBe(768);
  });

  it('empty capture yields no notes and does not throw', () => {
    const r = rec();
    r.start({ mode: 'replace', existingNotes: [], clipLengthTicks: 384, barTicks: 384, posTicks: () => 0 });
    expect(r.stop().notes.length).toBe(0);
  });
});
