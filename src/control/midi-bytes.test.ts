// src/control/midi-bytes.test.ts
import { describe, it, expect } from 'vitest';
import { statusType, channel, isNoteOn, isNoteOff, isCC, cc14 } from './midi-bytes';

describe('midi-bytes', () => {
  it('decodes status nibble and channel', () => {
    expect(statusType(0x90)).toBe(0x90); // note-on
    expect(statusType(0x95)).toBe(0x90);
    expect(channel(0x95)).toBe(5);
    expect(statusType(0xB0)).toBe(0xB0); // control change
  });

  it('treats note-on with velocity 0 as note-off', () => {
    expect(isNoteOn([0x90, 60, 100])).toBe(true);
    expect(isNoteOn([0x90, 60, 0])).toBe(false);
    expect(isNoteOff([0x90, 60, 0])).toBe(true);
    expect(isNoteOff([0x80, 60, 64])).toBe(true);
  });

  it('detects control change', () => {
    expect(isCC([0xB0, 48, 127])).toBe(true);
    expect(isCC([0x90, 48, 127])).toBe(false);
  });

  it('normalises a 7-bit CC value to 0..1', () => {
    expect(cc14(0)).toBe(0);
    expect(cc14(127)).toBe(1);
    expect(cc14(64)).toBeCloseTo(0.5039, 3);
  });
});
