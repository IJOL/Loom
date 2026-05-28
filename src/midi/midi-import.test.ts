import { describe, it, expect } from 'vitest';
import { parseMidiFile } from './midi-import';

// Builds a minimal single-track SMF containing one note-on/note-off pair at
// the given velocity. Lets us verify that the parser propagates real MIDI
// velocity instead of discarding it for a hardcoded value.
function buildOneNoteSmf(note: number, velocity: number, durationTicks = 96): Uint8Array {
  // Track events: delta=0 note-on, delta=durationTicks note-off, delta=0 EOT.
  const trackEvents = [
    0x00, 0x90, note, velocity,         // note on ch0
    durationTicks, 0x80, note, 0,       // note off ch0 (durationTicks < 128 → 1-byte VLQ)
    0x00, 0xff, 0x2f, 0x00,             // end of track
  ];
  const trackLen = trackEvents.length;
  const header = [
    0x4d, 0x54, 0x68, 0x64,             // 'MThd'
    0x00, 0x00, 0x00, 0x06,             // header length = 6
    0x00, 0x00,                         // format 0
    0x00, 0x01,                         // 1 track
    0x00, 0x60,                         // division = 96 ticks/quarter
  ];
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b,             // 'MTrk'
    (trackLen >> 24) & 0xff, (trackLen >> 16) & 0xff,
    (trackLen >> 8) & 0xff, trackLen & 0xff,
  ];
  return new Uint8Array([...header, ...trackHeader, ...trackEvents]);
}

describe('parseMidiFile velocity', () => {
  it('propagates real note-on velocity instead of a hardcoded constant', () => {
    const buf = buildOneNoteSmf(60, 100);
    const { tracks } = parseMidiFile(buf);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].notes).toHaveLength(1);
    expect(tracks[0].notes[0].velocity).toBe(100);
  });

  it('preserves a low velocity (47) round-trip', () => {
    const buf = buildOneNoteSmf(64, 47);
    const { tracks } = parseMidiFile(buf);
    expect(tracks[0].notes[0].velocity).toBe(47);
  });

  it('preserves a max velocity (127)', () => {
    const buf = buildOneNoteSmf(72, 127);
    const { tracks } = parseMidiFile(buf);
    expect(tracks[0].notes[0].velocity).toBe(127);
  });
});
