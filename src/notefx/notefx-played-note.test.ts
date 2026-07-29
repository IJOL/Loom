// The note-FX contract: BY DEFAULT whatever a note-FX emits must CONTAIN the
// note that was actually played — no note-FX transposes it away behind your
// back. An octave control is fine, but it is a switch you have to throw; while
// it is off the control is bypassed entirely.
import { describe, it, expect } from 'vitest';
import { ChordProcessor, CHORD_PROCESSOR_DEFAULTS } from './chord-processor';
import { ArpProcessor, ARP_PROCESSOR_DEFAULTS } from './arp-processor';
import type { NoteFxEvent } from './notefx-types';

const ev = (note: number): NoteFxEvent[] => [{ note, time: 0, gate: 1.0, accent: true }];
const pitches = (r: NoteFxEvent[]) => r.map((e) => e.note);

describe('chord note-FX keeps the played note', () => {
  it('defaults leave the OCT control off — the chord is rooted on the played note', () => {
    expect(CHORD_PROCESSOR_DEFAULTS.octaveOn).toBe(false);
    const out = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS }).process(ev(60), { bpm: 120 });
    expect(pitches(out)).toEqual([60, 64, 67]);
  });

  it('OCT is ignored while the toggle is off (no silent transpose)', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, octave: 2, octaveOn: false });
    expect(pitches(p.process(ev(60), { bpm: 120 }))).toEqual([60, 64, 67]);
  });

  it('switching OCT on restores the plain transpose (you asked for it)', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, octave: 1, octaveOn: true });
    expect(pitches(p.process(ev(60), { bpm: 120 }))).toEqual([72, 76, 79]);
  });

  it('OCT on at 0 changes nothing', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, octave: 0, octaveOn: true });
    expect(pitches(p.process(ev(60), { bpm: 120 }))).toEqual([60, 64, 67]);
  });
});

describe('arp note-FX keeps the played note', () => {
  it('defaults span a single octave — no forced octave climbing', () => {
    expect(ARP_PROCESSOR_DEFAULTS.octaves).toBe(1);
    const out = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS }).process(ev(60), { bpm: 120 });
    expect(out[0].note).toBe(60);                          // starts on the played note
    expect(Math.max(...pitches(out))).toBeLessThan(60 + 12);
  });

  it('OCT above 1 is opt-in and still starts from the played note', () => {
    const out = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, octaves: 3 }).process(ev(60), { bpm: 120 });
    expect(out[0].note).toBe(60);
    expect(pitches(out).some((n) => n >= 72)).toBe(true);
  });
});
