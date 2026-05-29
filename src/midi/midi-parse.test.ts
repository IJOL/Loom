import { describe, it, expect } from 'vitest';
import { parseMidiFile } from './midi-parse';

function buildSmf(opts: { tempo?: number; note?: number; velocity?: number }): Uint8Array {
  const usPerQ = opts.tempo ? Math.round(60_000_000 / opts.tempo) : null;
  const tempoEvent = usPerQ != null
    ? [0x00, 0xff, 0x51, 0x03, (usPerQ >> 16) & 0xff, (usPerQ >> 8) & 0xff, usPerQ & 0xff]
    : [];
  const note = opts.note ?? 60;
  const vel = opts.velocity ?? 100;
  const trackEvents = [
    ...tempoEvent,
    0x00, 0x90, note, vel,
    0x60, 0x80, note, 0,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const len = trackEvents.length;
  return new Uint8Array([
    0x4d,0x54,0x68,0x64, 0x00,0x00,0x00,0x06,
    0x00,0x00, 0x00,0x01, 0x00,0x60,
    0x4d,0x54,0x72,0x6b,
    (len>>24)&0xff,(len>>16)&0xff,(len>>8)&0xff,len&0xff,
    ...trackEvents,
  ]);
}

describe('parseMidiFile', () => {
  it('extracts bpm from a meta-tempo event', () => {
    const { bpm } = parseMidiFile(buildSmf({ tempo: 128 }));
    expect(bpm).toBeCloseTo(128, 0);
  });

  it('returns null bpm when no tempo event present', () => {
    const { bpm } = parseMidiFile(buildSmf({}));
    expect(bpm).toBeNull();
  });

  it('preserves velocity round-trip', () => {
    const { tracks } = parseMidiFile(buildSmf({ velocity: 47 }));
    expect(tracks[0].notes[0].velocity).toBe(47);
  });

  it('parses a real fixture file (sweet-dreams.mid)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const buf = new Uint8Array(fs.readFileSync(path.resolve('tests/fixtures/midi/sweet-dreams.mid')));
    const parsed = parseMidiFile(buf);
    expect(parsed.tracks.length).toBeGreaterThan(0);
    expect(parsed.division).toBeGreaterThan(0);
    // Most pop MIDIs have a tempo
    expect(parsed.bpm === null || (parsed.bpm > 40 && parsed.bpm < 240)).toBe(true);
    // At least one tonal track exists
    const tonal = parsed.tracks.filter((t) => t.notes.length > 0 && !t.notes.every((n) => n.channel === 9));
    expect(tonal.length).toBeGreaterThan(0);
  });
});
