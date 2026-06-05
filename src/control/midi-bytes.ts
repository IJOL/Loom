// src/control/midi-bytes.ts
/** Pure helpers over raw MIDI status/data bytes. No Web MIDI, no Loom. */

export type Bytes = ArrayLike<number>;

/** High nibble of the status byte (message type), e.g. 0x90 note-on, 0xB0 CC. */
export function statusType(status: number): number {
  return status & 0xf0;
}

/** Low nibble of the status byte (0-based channel 0..15). */
export function channel(status: number): number {
  return status & 0x0f;
}

/** True for a real note-on (note-on status AND velocity > 0). */
export function isNoteOn(data: Bytes): boolean {
  return statusType(data[0]) === 0x90 && data[2] > 0;
}

/** True for a note-off OR a note-on with velocity 0 (the common "running status" off). */
export function isNoteOff(data: Bytes): boolean {
  const t = statusType(data[0]);
  return t === 0x80 || (t === 0x90 && data[2] === 0);
}

/** True for a control-change message. */
export function isCC(data: Bytes): boolean {
  return statusType(data[0]) === 0xb0;
}

/** Normalise a 7-bit value (0..127) to 0..1. */
export function cc14(value: number): number {
  return value / 127;
}
