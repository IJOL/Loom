import { describe, it, expect, vi } from 'vitest';
import { emptyArrangementState } from './performance';
import {
  createRecState, armRec, disarmRec, startRecording, stopRecording,
  markParamTouched, tickRecAutomation, arrangementNow,
} from './rec-state';

describe('RecState lifecycle', () => {
  it('armRec sets armed=true; startRecording flips recording when armed', () => {
    const rec = createRecState();
    expect(rec.armed).toBe(false);
    armRec(rec);
    expect(rec.armed).toBe(true);
    expect(rec.recording).toBe(false);
    startRecording(rec, /*nowCtx=*/10);
    expect(rec.recording).toBe(true);
    expect(rec.startedAtCtx).toBe(10);
  });

  it('startRecording is a no-op when not armed', () => {
    const rec = createRecState();
    startRecording(rec, 10);
    expect(rec.recording).toBe(false);
  });

  it('stopRecording flips recording back to false', () => {
    const rec = createRecState();
    armRec(rec);
    startRecording(rec, 10);
    stopRecording(rec);
    expect(rec.recording).toBe(false);
  });

  it('disarmRec also stops an in-progress recording', () => {
    const rec = createRecState();
    armRec(rec);
    startRecording(rec, 10);
    disarmRec(rec);
    expect(rec.armed).toBe(false);
    expect(rec.recording).toBe(false);
  });
});

describe('arrangementNow', () => {
  it('returns now - startedAtCtx, clamped to >= 0', () => {
    const rec = createRecState();
    armRec(rec); startRecording(rec, 100);
    expect(arrangementNow(rec, 102.5)).toBeCloseTo(2.5, 5);
    expect(arrangementNow(rec, 99)).toBe(0);
  });
});

describe('tickRecAutomation sample-and-hold', () => {
  it('writes the current knob value for every paramId touched since last tick', () => {
    const rec = createRecState();
    armRec(rec); startRecording(rec, 0);
    const state = emptyArrangementState(120);
    const reads: Record<string, number> = { 'tb-303-1.cutoff': 0.7, 'fx.reverb': 0.4 };
    const readValue = vi.fn((id: string) => reads[id]);

    markParamTouched(rec, 'tb-303-1.cutoff');
    markParamTouched(rec, 'fx.reverb');

    tickRecAutomation({
      rec, state, nowCtx: 0.5, bpm: 120, laneIds: ['tb-303-1'], readValue,
    });

    expect(readValue).toHaveBeenCalledWith('tb-303-1.cutoff');
    expect(readValue).toHaveBeenCalledWith('fx.reverb');
    expect(state.lanes[0].automation[0].paramId).toBe('tb-303-1.cutoff');
    expect(state.globalAutomation[0].paramId).toBe('fx.reverb');
  });

  it('clears the touched set after each tick (no double-write)', () => {
    const rec = createRecState();
    armRec(rec); startRecording(rec, 0);
    const state = emptyArrangementState(120);
    const readValue = vi.fn(() => 0.5);
    markParamTouched(rec, 'fx.reverb');
    tickRecAutomation({ rec, state, nowCtx: 0.1, bpm: 120, laneIds: [], readValue });
    tickRecAutomation({ rec, state, nowCtx: 0.2, bpm: 120, laneIds: [], readValue });
    expect(readValue).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when not recording', () => {
    const rec = createRecState();
    const state = emptyArrangementState(120);
    const readValue = vi.fn(() => 0.5);
    markParamTouched(rec, 'fx.reverb');
    tickRecAutomation({ rec, state, nowCtx: 0.1, bpm: 120, laneIds: [], readValue });
    expect(readValue).not.toHaveBeenCalled();
  });
});
