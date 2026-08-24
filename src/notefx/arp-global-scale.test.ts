// The arp follows the session's tonality by default.
//
// It used to carry its own five-name scale list AND its own interval table,
// both duplicates of core/musicality — and neither followed the session, so an
// arp in a C major project happily walked E major because you played an E.
import { describe, it, expect } from 'vitest';
import { generateArpSequence, ArpProcessor, ARP_PROCESSOR_DEFAULTS } from './arp-processor';
import { inScale } from '../core/musicality';

const C_MAJOR = { key: 0, scale: 'major' as const };

describe('scale: global', () => {
  it('walks the degrees of the KEY from the note you played', () => {
    // Playing E in C major: E-F-G-A-B, the notes the key has.
    expect(generateArpSequence(64, 'up', 1, 'global', 5, C_MAJOR)).toEqual([64, 65, 67, 69, 71]);
  });

  it('is not the same as transposing a scale onto the note', () => {
    // The fixed 'major' rooted on E is E major — E-F#-G#-A-B — and out of key.
    const fixed = generateArpSequence(64, 'up', 1, 'major', 5);
    const global = generateArpSequence(64, 'up', 1, 'global', 5, C_MAJOR);
    expect(fixed).not.toEqual(global);
    expect(fixed.every((n) => inScale(n, 0, 'major'))).toBe(false);
    expect(global.every((n) => inScale(n, 0, 'major'))).toBe(true);
  });

  it('keeps every note in key from any starting note', () => {
    for (const played of [60, 61, 62, 63, 66, 70]) {
      const notes = generateArpSequence(played, 'up', 2, 'global', 8, C_MAJOR);
      // The played note itself is whatever you played — the arp does not move it.
      for (const n of notes.slice(1)) {
        expect(inScale(n, 0, 'major'), `${n} (from ${played}) is out of key`).toBe(true);
      }
    }
  });

  it('follows the key when the key changes, without touching the arp', () => {
    // Eight notes, not four: from C the two keys agree for the first four
    // (C-D-E-F) and only part company at the seventh — B natural against Bb.
    const inC = generateArpSequence(60, 'up', 1, 'global', 8, { key: 0, scale: 'major' });
    const inF = generateArpSequence(60, 'up', 1, 'global', 8, { key: 5, scale: 'major' });
    expect(inC).not.toEqual(inF);
  });

  it('still emits something when the context carries no tonality', () => {
    const notes = generateArpSequence(60, 'up', 1, 'global', 4);
    expect(notes).toHaveLength(4);
    expect(notes[0]).toBe(60);
  });
});

describe('the fixed scales are still there', () => {
  it('walk their intervals from the played note, unchanged', () => {
    expect(generateArpSequence(60, 'up', 1, 'pentMinor', 5)).toEqual([60, 63, 65, 67, 70]);
    expect(generateArpSequence(60, 'up', 1, 'chromatic', 4)).toEqual([60, 61, 62, 63]);
  });
});

describe('the default', () => {
  it('is to follow the session', () => {
    expect(ARP_PROCESSOR_DEFAULTS.scale).toBe('global');
  });

  it('reaches the processor, not just the helper', () => {
    const arp = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, rate: 'free', rateFreeHz: 16 });
    const out = arp.process(
      [{ note: 64, time: 0, gate: 0.5, accent: false }],
      { bpm: 120, key: 0, scale: 'major' },
    );
    expect(out.length).toBeGreaterThan(1);
    for (const e of out) expect(inScale(e.note, 0, 'major'), `${e.note} out of key`).toBe(true);
  });
});
