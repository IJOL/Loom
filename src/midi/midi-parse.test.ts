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

  it('demultiplexes a multi-channel (format-0) track into one track per channel', () => {
    // One MTrk carrying two instruments on channels 0 and 1 (a format-0 layout).
    const ev = [
      0x00, 0xc0, 33,        // ch0 program = 33 (Electric Bass)
      0x00, 0x90, 36, 100,   // ch0 note on
      0x60, 0x80, 36, 0,     // ch0 note off
      0x00, 0xc1, 56,        // ch1 program = 56 (Trumpet)
      0x00, 0x91, 64, 90,    // ch1 note on
      0x60, 0x81, 64, 0,     // ch1 note off
      0x00, 0xff, 0x2f, 0x00,
    ];
    const len = ev.length;
    const buf = new Uint8Array([
      0x4d,0x54,0x68,0x64, 0x00,0x00,0x00,0x06,
      0x00,0x00, 0x00,0x01, 0x00,0x60,
      0x4d,0x54,0x72,0x6b,
      (len>>24)&0xff,(len>>16)&0xff,(len>>8)&0xff,len&0xff,
      ...ev,
    ]);
    const { tracks } = parseMidiFile(buf);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].program).toBe(33);
    expect(tracks[0].notes.every((n) => n.channel === 0)).toBe(true);
    expect(tracks[1].program).toBe(56);
    expect(tracks[1].notes.every((n) => n.channel === 1)).toBe(true);
    expect(tracks.map((t) => t.index)).toEqual([0, 1]);
  });

  it('collapses junk tempo events crammed at the start to the effective tempo', () => {
    // Mirrors Calvin Harris: 100, 100, 128 within a few ticks at the very start —
    // 128 is the real tempo. The parser must report 128 (not the literal first 100)
    // and collapse the cluster to a single tempo entry.
    const us = (bpm: number) => Math.round(60_000_000 / bpm);
    const u3 = (n: number) => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    const ev = [
      0x00, 0xff, 0x51, 0x03, ...u3(us(100)),
      0x01, 0xff, 0x51, 0x03, ...u3(us(100)),
      0x01, 0xff, 0x51, 0x03, ...u3(us(128)),
      0x00, 0x90, 60, 100,
      0x60, 0x80, 60, 0,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const len = ev.length;
    const buf = new Uint8Array([
      0x4d,0x54,0x68,0x64, 0,0,0,6, 0,0, 0,1, 0,96,
      0x4d,0x54,0x72,0x6b, (len>>24)&0xff,(len>>16)&0xff,(len>>8)&0xff,len&0xff,
      ...ev,
    ]);
    const parsed = parseMidiFile(buf);
    expect(Math.round(parsed.bpm ?? 0)).toBe(128);
    expect(parsed.tempos).toHaveLength(1);
    expect(Math.round(parsed.tempos![0].bpm)).toBe(128);
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
