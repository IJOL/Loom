import { describe, it, expect } from 'vitest';
import { noteName } from './note-name';
import { noteName as reExported } from './sampler-keyboard-map';

describe('noteName', () => {
  it('names a MIDI note in Loom\'s octave convention', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(57)).toBe('A3');
  });
  it('is the same function sampler-keyboard-map re-exports (no drift)', () => {
    expect(reExported).toBe(noteName);
  });
});
