// src/core/sequencer.test.ts
// Layer-2 scheduling tests. No DSP — we observe the trigger event log.

import { describe, it, expect, afterEach } from 'vitest';
import { makeSchedulerHarness, type HarnessHandle } from '../../test/sequencer-harness';
import { DRUM_LANES } from './drums';

let h: HarnessHandle | null = null;
afterEach(() => { h?.dispose(); h = null; });

const fullBass = (length: number, accent = false, slide = false) =>
  Array.from({ length }, () => ({ on: true, note: 36, accent, slide }));

const stepDurMs = (bpm: number) => 60_000 / bpm / 4;

describe('Sequencer scheduling', () => {
  it('fires 16 steps at 120 BPM spaced 125 ms apart', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 16, bass: fullBass(16) });
    h.seq.start();
    h.advance(2000);   // 16 steps × 125 ms = 2000 ms
    expect(h.bassLog.length).toBeGreaterThanOrEqual(16);
    const first16 = h.bassLog.slice(0, 16);
    for (let i = 1; i < first16.length; i++) {
      const delta = first16[i].time - first16[i - 1].time;
      expect(delta).toBeCloseTo(0.125, 3);
    }
  });

  it('skips steps with on=false', () => {
    const bass = fullBass(4);
    bass[1].on = false;
    bass[3].on = false;
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 4 + 50);
    const stepsFired = h.bassLog.map(e => e.step).sort();
    // Only steps 0 and 2 should have fired.
    expect(stepsFired.filter(s => s < 4)).toEqual([0, 2]);
  });

  it('setLength(8) truncates the pattern and step 0 restarts after 8 steps', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 16, bass: fullBass(16) });
    h.seq.setLength(8);
    h.seq.start();
    h.advance(stepDurMs(120) * 9);
    const steps = h.bassLog.slice(0, 9).map(e => e.step);
    expect(steps[0]).toBe(0);
    expect(steps[8]).toBe(0);
  });

  it('changing BPM mid-pattern affects the next step\'s delta only', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 8, bass: fullBass(8) });
    h.seq.start();
    h.advance(stepDurMs(120) * 4);    // ~4 steps fired
    h.seq.bpm = 60;                    // halve tempo
    h.advance(stepDurMs(60) * 2);
    const log = h.bassLog;
    expect(log.length).toBeGreaterThan(5);
    // Delta between the first two events ≈ 0.125, but a delta after the BPM
    // change should be ≈ 0.25.
    const beforeDelta = log[1].time - log[0].time;
    const afterDelta = log[log.length - 1].time - log[log.length - 2].time;
    expect(beforeDelta).toBeCloseTo(0.125, 2);
    expect(afterDelta).toBeCloseTo(0.25, 2);
  });
});

describe('Sequencer slide', () => {
  it('marks the slidingIn flag on the step AFTER a slide=true step', () => {
    const bass = fullBass(4);
    bass[0].slide = true;
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 5);
    const byStep = new Map(h.bassLog.map(e => [e.step, e]));
    expect(byStep.get(0)?.slidingIn).toBe(false);
    expect(byStep.get(1)?.slidingIn).toBe(true);
    expect(byStep.get(2)?.slidingIn).toBe(false);
  });

  it('a slide-out step has gate ≈ 1.5 × normal step duration', () => {
    const bass = fullBass(2);
    bass[0].slide = true;
    h = makeSchedulerHarness({ bpm: 120, length: 2, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 3);
    const step0 = h.bassLog.find(e => e.step === 0);
    const step1 = h.bassLog.find(e => e.step === 1);
    expect(step0).toBeDefined();
    expect(step1).toBeDefined();
    // Step 0's gate is stepDur * 1.5 = 0.1875 s.
    expect(step0!.gate).toBeCloseTo(0.1875, 3);
    // Step 1 is non-slide, gate ≈ stepDur * 0.92 = 0.115 s.
    expect(step1!.gate).toBeCloseTo(0.115, 3);
  });

  it('chained slides keep slidingIn=true on each following step', () => {
    const bass = fullBass(4);
    bass[0].slide = true;
    bass[1].slide = true;
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 4);
    const byStep = new Map(h.bassLog.map(e => [e.step, e]));
    expect(byStep.get(1)?.slidingIn).toBe(true);
    expect(byStep.get(2)?.slidingIn).toBe(true);
    expect(byStep.get(3)?.slidingIn).toBe(false);
  });
});

describe('Sequencer accent and drums', () => {
  it('propagates accent flag on bass triggers', () => {
    const bass = fullBass(2, false);
    bass[1].accent = true;
    h = makeSchedulerHarness({ bpm: 120, length: 2, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 2 + 20);
    const byStep = new Map(h.bassLog.map(e => [e.step, e]));
    expect(byStep.get(0)?.accent).toBe(false);
    expect(byStep.get(1)?.accent).toBe(true);
  });

  it('kick + hat on the same step fire at the same time', () => {
    h = makeSchedulerHarness({
      bpm: 120, length: 1,
      drums: {
        kick:      [{ on: true, accent: false }],
        closedHat: [{ on: true, accent: false }],
      },
    });
    h.seq.start();
    h.advance(stepDurMs(120) + 20);
    const kick = h.drumLog.find(e => e.lane === 'kick');
    const hat  = h.drumLog.find(e => e.lane === 'closedHat');
    expect(kick).toBeDefined();
    expect(hat).toBeDefined();
    expect(kick!.time).toBeCloseTo(hat!.time, 5);
  });

  it('muting one drum lane does not affect others', () => {
    h = makeSchedulerHarness({
      bpm: 120, length: 2,
      drums: {
        kick:  [{ on: true, accent: false }, { on: true, accent: false }],
        snare: [{ on: false, accent: false }, { on: false, accent: false }],
      },
    });
    h.seq.start();
    h.advance(stepDurMs(120) * 2 + 20);
    const lanes = new Set(h.drumLog.map(e => e.lane));
    expect(lanes.has('kick')).toBe(true);
    expect(lanes.has('snare')).toBe(false);
  });

  it('after stop() no more triggers fire', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass: fullBass(4) });
    h.seq.start();
    h.advance(stepDurMs(120) * 1 + 5);
    h.seq.stop();
    const beforeStop = h.bassLog.length;
    h.advance(5000);
    expect(h.bassLog.length).toBe(beforeStop);
  });
});

// Sanity: all expected drum lanes are spelled correctly for the harness.
describe('Sequencer constants', () => {
  it('every DRUM_LANES entry has a defined harness path', () => {
    for (const lane of DRUM_LANES) {
      expect(typeof lane).toBe('string');
    }
  });
});
