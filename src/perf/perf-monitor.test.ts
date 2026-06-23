import { describe, it, expect } from 'vitest';
import { PerfMonitor, LATE_TICK_MS } from './perf-monitor';

describe('PerfMonitor', () => {
  it('tracks voices per lane and total, sorted desc, clamped at 0', () => {
    const m = new PerfMonitor();
    m.incVoice('bass'); m.incVoice('bass'); m.incVoice('drums');
    let s = m.snapshot();
    expect(s.voicesTotal).toBe(3);
    expect(s.voicesByLane[0]).toEqual({ laneId: 'bass', count: 2 }); // highest first
    m.decVoice('drums'); m.decVoice('drums'); // over-decrement must not go negative
    s = m.snapshot();
    expect(s.voicesTotal).toBe(2);
    expect(s.voicesByLane.find((l) => l.laneId === 'drums')).toBeUndefined();
  });

  it('counts live generator nodes, never below zero', () => {
    const m = new PerfMonitor();
    m.incNode(); m.incNode(); m.decNode();
    expect(m.snapshot().genNodes).toBe(1);
    m.decNode(); m.decNode();
    expect(m.snapshot().genNodes).toBe(0);
  });

  it('logs a late-tick event only when lag is at/above threshold', () => {
    const m = new PerfMonitor();
    m.recordTick(LATE_TICK_MS - 1, 1, 10);   // below → no event
    m.recordTick(LATE_TICK_MS + 5, 1, 11);   // at/above → one event
    const s = m.snapshot();
    expect(s.events.length).toBe(1);
    expect(s.events[0].kind).toBe('late-tick');
    expect(s.lagMaxMs).toBeGreaterThanOrEqual(LATE_TICK_MS + 5);
  });

  it('logs an underrun event only when underrunRatio is positive', () => {
    const m = new PerfMonitor();
    m.recordAudioLoad(0.3, 0.5, 0, 1);    // no underrun → no event
    m.recordAudioLoad(0.4, 0.6, 0.02, 2); // underrun → event
    const s = m.snapshot();
    expect(s.audioSupported).toBe(true);
    expect(s.events.filter((e) => e.kind === 'underrun').length).toBe(1);
    expect(s.peakLoad).toBeGreaterThan(s.avgLoad);
  });

  it('records master peak/reduction and logs ONE clip event per rising edge', () => {
    const m = new PerfMonitor();
    m.recordMaster(0.5, 0, 1);    // below 0 dBFS → no clip
    m.recordMaster(1.4, -6, 2);   // crosses → 1 clip
    m.recordMaster(1.6, -8, 3);   // still clipping → NO new event (no spam)
    m.recordMaster(0.7, -1, 4);   // drops below → reset edge
    m.recordMaster(1.2, -5, 5);   // crosses again → 2nd clip
    const s = m.snapshot();
    expect(s.masterClips).toBe(2);
    expect(s.events.filter((e) => e.kind === 'clip').length).toBe(2);
    expect(s.masterPeak).toBeCloseTo(1.2, 5);
    expect(s.masterReductionDb).toBe(-5);
  });

  it('caps history length and event log (newest first)', () => {
    const m = new PerfMonitor();
    for (let i = 0; i < 500; i++) m.recordFps(60 - (i % 10), 16);
    const s = m.snapshot();
    expect(s.histFps.length).toBeLessThanOrEqual(120);
    for (let i = 0; i < 100; i++) m.recordTick(LATE_TICK_MS + i, 1, i);
    const s2 = m.snapshot();
    expect(s2.events.length).toBeLessThanOrEqual(50);
    // newest first: the last recorded (i=99) sits at index 0
    expect(s2.events[0].detail).toContain(`${LATE_TICK_MS + 99}`);
  });
});
