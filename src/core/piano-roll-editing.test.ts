import { describe, it, expect } from 'vitest';
import {
  keyToSemitone, midiForKey, notesInRect, translateGroup,
  serializeClipboard, pasteTranslate, quantizeRecorded,
  clampOctaveBase, octaveBaseLabel,
  KEY_SEMITONES, PIANO_KEY_LEGEND,
  snapNoteMidi,
} from './piano-roll-editing';
import type { NoteEvent } from './notes';

const N = (start: number, midi: number, duration = 24, velocity = 80): NoteEvent => ({ start, midi, duration, velocity });
const BOUNDS = { patternTicks: 384, minMidi: 36, maxMidi: 96 };

describe('keyboard map', () => {
  it('maps home row to white keys and upper row to black keys', () => {
    expect(keyToSemitone('a')).toBe(0);
    expect(keyToSemitone('w')).toBe(1);
    expect(keyToSemitone('k')).toBe(12);
    expect(keyToSemitone('A')).toBe(0); // case-insensitive
    expect(keyToSemitone('q')).toBeNull(); // unused
    expect(keyToSemitone('1')).toBeNull();
  });
  it('midiForKey adds the octave base', () => {
    expect(midiForKey('a', 60)).toBe(60);
    expect(midiForKey('w', 60)).toBe(61);
    expect(midiForKey('k', 60)).toBe(72);
    expect(midiForKey('z', 60)).toBeNull(); // z/x are octave shifts, not notes
  });
});

describe('clampOctaveBase', () => {
  it('keeps an in-range base unchanged', () => {
    expect(clampOctaveBase(60, 36, 96)).toBe(60);
  });
  it('floors at minMidi', () => {
    expect(clampOctaveBase(60 - 12 * 4, 36, 96)).toBe(36); // 12 < 36 → clamp up
    expect(clampOctaveBase(0, 36, 96)).toBe(36);
  });
  it('leaves a full octave of headroom at the top', () => {
    expect(clampOctaveBase(96, 36, 96)).toBe(84); // maxMidi - 12
    expect(clampOctaveBase(200, 36, 96)).toBe(84);
  });
  it('shifting up by 12 from C4 then clamping lands one octave higher', () => {
    expect(clampOctaveBase(60 + 12, 36, 96)).toBe(72);
  });
});

describe('octaveBaseLabel', () => {
  it('labels the default base C4', () => {
    expect(octaveBaseLabel(60)).toBe('C4');
  });
  it('moves the label with the octave', () => {
    expect(octaveBaseLabel(72)).toBe('C5');
    expect(octaveBaseLabel(48)).toBe('C3');
  });
});

describe('notesInRect', () => {
  it('selects notes whose body intersects the rect (order-independent corners)', () => {
    const notes = [N(0, 60), N(48, 64), N(120, 72)];
    const hit = notesInRect(notes, { tick0: 60, tick1: 10, midi0: 66, midi1: 58 });
    expect(hit).toEqual([notes[0], notes[1]]); // midi 58..66 and ticks 10..60 — note[1] starts at 48, inside
  });
  it('excludes notes outside the pitch band', () => {
    const notes = [N(0, 60), N(0, 90)];
    expect(notesInRect(notes, { tick0: 0, tick1: 24, midi0: 58, midi1: 62 })).toEqual([notes[0]]);
  });
});

describe('translateGroup clamp', () => {
  it('clamps a leftward move so the earliest note stops at tick 0', () => {
    const g = [N(24, 60), N(48, 64)];
    expect(translateGroup(g, -100, 0, BOUNDS).dTick).toBe(-24);
  });
  it('clamps pitch so the top note stops at maxMidi', () => {
    const g = [N(0, 90), N(0, 84)];
    expect(translateGroup(g, 0, 100, BOUNDS).dMidi).toBe(6); // 96 - 90
  });
  it('passes a delta through when it stays in bounds', () => {
    expect(translateGroup([N(48, 60)], 24, 2, BOUNDS)).toEqual({ dTick: 24, dMidi: 2 });
  });
});

describe('clipboard round-trip', () => {
  it('serializes relative to the earliest start and pastes anchored to the mouse', () => {
    const sel = [N(48, 60), N(72, 67)];
    const clip = serializeClipboard(sel);
    expect(clip[0].dStart).toBe(0);
    expect(clip[1].dStart).toBe(24);
    const pasted = pasteTranslate(clip, 100, 62, BOUNDS);
    expect(pasted[0]).toMatchObject({ start: 100, midi: 62 });
    expect(pasted[1]).toMatchObject({ start: 124, midi: 69 }); // +24 tick, +7 semitone preserved
  });
  it('clamps a paste that runs past the pattern end back inside', () => {
    const clip = serializeClipboard([N(0, 60, 48)]);
    const pasted = pasteTranslate(clip, 380, 60, BOUNDS); // 380+48 = 428 > 384
    expect(pasted[0].start).toBe(336); // 384 - 48
  });
});

describe('PIANO_KEY_LEGEND coherence', () => {
  it('mentions every note key from KEY_SEMITONES', () => {
    for (const k of Object.keys(KEY_SEMITONES)) {
      expect(PIANO_KEY_LEGEND, `missing note key "${k}"`).toContain(k);
    }
  });
  it('mentions every editing shortcut the handlers implement', () => {
    const shortcuts = [
      'z', 'x', '1', '2',
      'Ctrl+A', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V',
      'Esc', '←', '→', '↑', '↓', '⌫',
    ];
    for (const s of shortcuts) {
      expect(PIANO_KEY_LEGEND, `missing shortcut "${s}"`).toContain(s);
    }
  });
  it('is written in English (no Spanish UI text)', () => {
    expect(PIANO_KEY_LEGEND.toLowerCase()).toContain('keyboard');
    expect(PIANO_KEY_LEGEND.toLowerCase()).not.toContain('teclado');
  });
});

describe('quantizeRecorded', () => {
  it('snaps start and rounds duration to at least one snap', () => {
    expect(quantizeRecorded(50, 60, 24)).toEqual({ start: 48, duration: 24 });
    expect(quantizeRecorded(0, 60, 24)).toEqual({ start: 0, duration: 72 }); // 60→round(2.5)=72? see note
  });
});

describe('snapNoteMidi', () => {
  const ctx = { inScale: (m: number) => [0, 2, 4, 5, 7, 9, 11].includes(((m % 12) + 12) % 12) }; // C major
  it('snaps when locked and out of scale (tie → up)', () => {
    expect(snapNoteMidi(61, ctx, true)).toBe(62); // C# → D (tie resolves up)
    expect(ctx.inScale(snapNoteMidi(61, ctx, true))).toBe(true);
  });
  it('passes through when locked and already in scale', () => {
    expect(snapNoteMidi(60, ctx, true)).toBe(60);
  });
  it('passes through unchanged when unlocked', () => {
    expect(snapNoteMidi(61, ctx, false)).toBe(61);
  });
});
