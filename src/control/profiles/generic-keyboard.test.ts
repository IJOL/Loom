// src/control/profiles/generic-keyboard.test.ts
import { describe, it, expect } from 'vitest';
import { genericKeyboard } from './generic-keyboard';

const ctx = { variant: 'mk1' as const };
const u8 = (...b: number[]) => Uint8Array.from(b);

describe('generic-keyboard', () => {
  it('detects anything with confidence 1 (fallback)', () => {
    expect(genericKeyboard.detect({ name: 'Whatever', manufacturer: '', id: 'x' })).toBe(1);
  });
  it('passes notes through as noteOn/noteOff (any note is a key)', () => {
    expect(genericKeyboard.parse(u8(0x90, 36, 80), ctx)).toEqual([{ type: 'noteOn', midi: 36, velocity: 80 }]);
    expect(genericKeyboard.parse(u8(0x80, 36, 0), ctx)).toEqual([{ type: 'noteOff', midi: 36 }]);
  });
  it('maps CC 1..8 to knob 0..7', () => {
    expect(genericKeyboard.parse(u8(0xB0, 1, 127), ctx)).toEqual([{ type: 'knob', index: 0, value01: 1 }]);
  });
  it('sustain CC 64', () => {
    expect(genericKeyboard.parse(u8(0xB0, 64, 0), ctx)).toEqual([{ type: 'sustain', on: false }]);
  });
  it('renders no LEDs', () => {
    expect(genericKeyboard.render({
      variant: 'mk1', cells: [], scenes: [], anyPlaying: false, activeLaneCol: null, knobBank: 'device',
    })).toEqual([]);
  });
});
