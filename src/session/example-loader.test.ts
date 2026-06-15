import { describe, it, expect } from 'vitest';
import { renderExampleNotes, validateExample, type Example } from './example-loader';
import { inScale } from '../core/musicality';

const melodic: Example = {
  id: 'b1', name: 'Acid roller', style: 'acid', kind: 'bass', bars: 1,
  degrees: [{ start: 0, duration: 24, degree: 0, octave: 0, velocity: 115 },
            { start: 24, duration: 24, degree: 2, octave: 0, velocity: 80 }],
};
const beat: Example = {
  id: 'd1', name: 'Four floor', style: 'house', kind: 'beat', bars: 1,
  notes: [{ start: 0, duration: 24, midi: 36, velocity: 115 }],
};

describe('example loader', () => {
  it('validates melodic and beat examples', () => {
    expect(validateExample(melodic)).toBe(true);
    expect(validateExample(beat)).toBe(true);
    expect(validateExample({ id: 'x' })).toBe(false);
  });
  it('renders melodic degrees into the target tonality (in scale)', () => {
    const notes = renderExampleNotes(melodic, { key: 9, scale: 'minor' }, 36);
    expect(notes.length).toBe(2);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });
  it('passes beat notes through unchanged (GM)', () => {
    const notes = renderExampleNotes(beat, { key: 9, scale: 'minor' }, 36);
    expect(notes[0].midi).toBe(36);
  });
});
