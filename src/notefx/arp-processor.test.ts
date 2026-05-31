// src/notefx/arp-processor.test.ts
import { describe, it, expect } from 'vitest';
import { ArpProcessor, ARP_PROCESSOR_DEFAULTS } from './arp-processor';
import type { NoteFxEvent } from './notefx-types';

const ev = (note: number): NoteFxEvent => ({ note, time: 0, gate: 1.0, accent: true });

describe('ArpProcessor', () => {
  it('passthrough when disabled params produce a single note (no expansion at gate 0)', () => {
    // A degenerate gate shorter than one interval yields exactly the root once.
    const p = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, rateFreeHz: 1, rate: 'free' });
    const out = p.process([{ note: 60, time: 0, gate: 0.001, accent: true }], { bpm: 120 });
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe(60);
  });

  it("'up' over 1 octave pentMinor spreads ascending notes across the gate", () => {
    // pentMinor intervals [0,3,5,7,10]; 1 octave; free rate 10Hz → 0.1s interval.
    const p = new ArpProcessor({
      ...ARP_PROCESSOR_DEFAULTS,
      pattern: 'up', scale: 'pentMinor', octaves: 1, rate: 'free', rateFreeHz: 10, gate: 1.0,
    });
    const out = p.process([ev(60)], { bpm: 120 }); // gate 1.0s / 0.1s = 10 notes
    expect(out.length).toBe(10);
    expect(out[0].note).toBe(60);
    expect(out[1].note).toBe(63);   // +3
    expect(out[2].note).toBe(65);   // +5
    expect(out[0].time).toBeCloseTo(0, 5);
    expect(out[1].time).toBeCloseTo(0.1, 5);
    // accent only on the first step
    expect(out[0].accent).toBe(true);
    expect(out[1].accent).toBe(false);
  });

  it('processes EACH input note independently (chord → arp use case)', () => {
    const p = new ArpProcessor({
      ...ARP_PROCESSOR_DEFAULTS,
      pattern: 'up', scale: 'major', octaves: 1, rate: 'free', rateFreeHz: 10, gate: 1.0,
    });
    const out = p.process([ev(60), ev(67)], { bpm: 120 });
    // Two roots, each expanded; output contains both 60- and 67-rooted runs.
    expect(out.some((e) => e.note === 60)).toBe(true);
    expect(out.some((e) => e.note === 67)).toBe(true);
    expect(out.length).toBe(20);
  });
});
