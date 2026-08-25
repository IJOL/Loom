// Which chord is sounding at a scheduled time. The note-FX ask this per note,
// and the answer has to be about the note's OWN time rather than about now:
// the scheduler runs ahead of the transport, so "now" is a different bar from
// the note's exactly at a chord change — the one place a listener would hear it.
import { describe, it, expect } from 'vitest';
import { chordDegreeAtTime } from './chord-track';
import { progressionById } from './progression';
import { DEFAULT_METER } from '../core/meter';

const BPM = 120;                       // 4/4 at 120 ⇒ a bar is exactly 2 s
const BAR = 2;
const at = (time: number, over: Record<string, unknown> = {}) => chordDegreeAtTime(
  { progression: 'i-VI-III-VII', ...over },
  { time, startedAtSec: 0, bpm: BPM, meter: DEFAULT_METER },
);

describe('chordDegreeAtTime', () => {
  it('walks the progression bar by bar', () => {
    const prog = progressionById('i-VI-III-VII')!.chords;
    expect(at(0)).toBe(prog[0].degree);
    expect(at(BAR)).toBe(prog[1].degree);
    expect(at(BAR * 2)).toBe(prog[2].degree);
  });

  it('wraps round at the end rather than running out', () => {
    const prog = progressionById('i-VI-III-VII')!.chords;
    expect(at(BAR * 4)).toBe(prog[0].degree);
  });

  it('answers for the note\'s time, not for the clock', () => {
    // A note scheduled a bar ahead belongs to the NEXT chord. Reading "now"
    // would hand it the current one and the change would land a bar late.
    expect(at(BAR * 0.99)).not.toBe(at(BAR * 1.01));
  });

  it('holds the same chord across its own bar', () => {
    expect(at(0)).toBe(at(BAR * 0.5));
    expect(at(0)).toBe(at(BAR * 0.99));
  });

  it('is undefined before the transport has ever run', () => {
    expect(chordDegreeAtTime(
      { progression: 'i-VI-III-VII' },
      { time: 5, startedAtSec: null, bpm: BPM, meter: DEFAULT_METER },
    )).toBeUndefined();
  });

  it('never goes negative when a note is scheduled before the start', () => {
    // Clamped rather than wrapping to the end of the progression, which would
    // name a chord that has not been reached yet.
    expect(at(-10)).toBe(at(0));
  });

  it('survives a nonsense tempo instead of dividing by zero', () => {
    expect(chordDegreeAtTime(
      { progression: 'i-VI-III-VII' },
      { time: 5, startedAtSec: 0, bpm: 0, meter: DEFAULT_METER },
    )).toBeUndefined();
  });

  it('lets a written progression win over the catalogue, like everything else', () => {
    const written = chordDegreeAtTime(
      { progression: 'i-VI-III-VII', chords: [{ degree: 5, bars: 4 }] },
      { time: 0, startedAtSec: 0, bpm: BPM, meter: DEFAULT_METER },
    );
    expect(written).toBe(5);
  });
});
