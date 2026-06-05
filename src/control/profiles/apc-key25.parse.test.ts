// src/control/profiles/apc-key25.parse.test.ts
import { describe, it, expect } from 'vitest';
import { apcKey25 } from './apc-key25';

const ctx = { variant: 'mk1' as const };
const u8 = (...b: number[]) => Uint8Array.from(b);

describe('apc-key25 detect + variantFor', () => {
  it('matches by port name and resolves variant', () => {
    expect(apcKey25.detect({ name: 'APC Key 25', manufacturer: 'Akai', id: 'a' })).toBeGreaterThan(0);
    expect(apcKey25.detect({ name: 'APC Key 25 mk2', manufacturer: 'Akai', id: 'a' })).toBeGreaterThan(0);
    expect(apcKey25.detect({ name: 'Some Other Synth', manufacturer: '', id: 'b' })).toBe(0);
    expect(apcKey25.variantFor({ name: 'APC Key 25 mk2', manufacturer: 'Akai', id: 'a' })).toBe('mk2');
    expect(apcKey25.variantFor({ name: 'APC Key 25', manufacturer: 'Akai', id: 'a' })).toBe('mk1');
  });
});

describe('apc-key25 parse', () => {
  it('pad note 0 (bottom-left) → padPress col 0 row 4 (bottom row)', () => {
    expect(apcKey25.parse(u8(0x90, 0, 100), ctx)).toEqual([{ type: 'padPress', col: 0, row: 4 }]);
  });
  it('pad note 39 (top-right) → padPress col 7 row 0 (top row)', () => {
    expect(apcKey25.parse(u8(0x90, 39, 100), ctx)).toEqual([{ type: 'padPress', col: 7, row: 0 }]);
  });
  it('pad note-off is ignored (launch fires on press only)', () => {
    expect(apcKey25.parse(u8(0x80, 0, 0), ctx)).toEqual([]);
  });
  it('keyboard note (>=40) → noteOn / noteOff with velocity', () => {
    expect(apcKey25.parse(u8(0x90, 60, 90), ctx)).toEqual([{ type: 'noteOn', midi: 60, velocity: 90 }]);
    expect(apcKey25.parse(u8(0x80, 60, 0), ctx)).toEqual([{ type: 'noteOff', midi: 60 }]);
    expect(apcKey25.parse(u8(0x90, 60, 0), ctx)).toEqual([{ type: 'noteOff', midi: 60 }]);
  });
  it('knob CC 48..55 → knob index 0..7 value 0..1', () => {
    expect(apcKey25.parse(u8(0xB0, 48, 127), ctx)).toEqual([{ type: 'knob', index: 0, value01: 1 }]);
    expect(apcKey25.parse(u8(0xB0, 55, 0), ctx)).toEqual([{ type: 'knob', index: 7, value01: 0 }]);
  });
  it('sustain pedal CC 64 → sustain on/off', () => {
    expect(apcKey25.parse(u8(0xB0, 64, 127), ctx)).toEqual([{ type: 'sustain', on: true }]);
    expect(apcKey25.parse(u8(0xB0, 64, 0), ctx)).toEqual([{ type: 'sustain', on: false }]);
  });
  it('scene buttons 82..86 → sceneLaunch row 0..4; STOP ALL 81 → stopAll', () => {
    expect(apcKey25.parse(u8(0x90, 82, 127), ctx)).toEqual([{ type: 'sceneLaunch', row: 0 }]);
    expect(apcKey25.parse(u8(0x90, 86, 127), ctx)).toEqual([{ type: 'sceneLaunch', row: 4 }]);
    expect(apcKey25.parse(u8(0x90, 81, 127), ctx)).toEqual([{ type: 'stopAll' }]);
  });
  it('LEFT 66 / RIGHT 67 → selectLane -1 / +1', () => {
    expect(apcKey25.parse(u8(0x90, 66, 127), ctx)).toEqual([{ type: 'selectLane', delta: -1 }]);
    expect(apcKey25.parse(u8(0x90, 67, 127), ctx)).toEqual([{ type: 'selectLane', delta: 1 }]);
  });
  it('bank buttons VOLUME/PAN/SEND/DEVICE → knobBank', () => {
    expect(apcKey25.parse(u8(0x90, 68, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'volume' }]);
    expect(apcKey25.parse(u8(0x90, 69, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'pan' }]);
    expect(apcKey25.parse(u8(0x90, 70, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'send' }]);
    expect(apcKey25.parse(u8(0x90, 71, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'device' }]);
  });
  it('button release (note-off) for transport-style buttons is ignored', () => {
    expect(apcKey25.parse(u8(0x80, 82, 0), ctx)).toEqual([]);
    expect(apcKey25.parse(u8(0x80, 68, 0), ctx)).toEqual([]);
  });
});
