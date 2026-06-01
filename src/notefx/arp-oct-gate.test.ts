import { describe, it, expect } from 'vitest';
import { ArpProcessor, ARP_PROCESSOR_DEFAULTS } from './arp-processor';
import type { NoteFxEvent } from './notefx-types';

// Regression for "OCT and GATE controls do nothing in the arp".
// Realistic clip note: a 1/4 note at 120 BPM = 0.5s gate.
const BPM = 120;
const note = (gate: number): NoteFxEvent[] => [{ note: 60, time: 0, gate, accent: true }];
const pitches = (r: NoteFxEvent[]) => r.map((e) => e.note);

describe('arp OCT control', () => {
  it('OCT changes the pitches even for a short note (octave-first pool ordering)', () => {
    // 1/16 @ 120 = 0.125s; a 0.5s note → only 4 steps. With the old
    // octave-LAST pool ordering, 4 steps never left octave 0, so OCT 1 vs 2
    // produced identical pitches — the reported "OCT does nothing". With
    // octave-FIRST ordering, octaves appear within the first few steps.
    const oct1 = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, octaves: 1, rate: '1/16' }).process(note(0.5), { bpm: BPM });
    const oct2 = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, octaves: 2, rate: '1/16' }).process(note(0.5), { bpm: BPM });
    expect(pitches(oct1)).not.toEqual(pitches(oct2));
    // oct2 must actually contain a note an octave (12 semitones) above the root.
    expect(pitches(oct2).some((n) => n >= 60 + 12)).toBe(true);
  });

  it('OCT=1 is unchanged (single octave behaves exactly as the scale walk)', () => {
    // pentMinor up, 1 octave, 4 steps → root + first 3 scale degrees.
    const out = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, octaves: 1, rate: '1/16' }).process(note(0.5), { bpm: BPM });
    expect(pitches(out)).toEqual([60, 63, 65, 67]); // pentMinor [0,3,5,7,10]
  });
});

describe('arp GATE control', () => {
  it('GATE scales each produced note duration', () => {
    const lo = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, gate: 0.1, rate: '1/16' }).process(note(0.5), { bpm: BPM });
    const hi = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, gate: 1.0, rate: '1/16' }).process(note(0.5), { bpm: BPM });
    expect(hi[0].gate).toBeGreaterThan(lo[0].gate * 5);
  });
});
