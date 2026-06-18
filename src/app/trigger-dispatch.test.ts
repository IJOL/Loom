// src/app/trigger-dispatch.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTriggerForLane } from './trigger-dispatch';
import { getNoteFxChain, _resetNoteFxRegistry } from '../notefx/notefx-registry';

function fakeDeps(fired: Array<{ note: number; time: number }>) {
  const engine = {
    id: 'subtractive',
    createVoice: () => ({ trigger: (note: number, time: number) => fired.push({ note, time }) }),
  };
  return {
    ctx: {} as AudioContext,
    laneResources: { get: (_id: string) => ({ engine, strip: { input: {} } }) } as any,
    seq: { bpm: 120 } as any,
  };
}

describe('createTriggerForLane velocity', () => {
  it('passes velocity into Voice.trigger', () => {
    const seen: number[] = [];
    const fakeVoice = { trigger: (_m: number, _t: number, o: any) => seen.push(o.velocity), release() {}, connect() {}, dispose() {}, getAudioParams: () => new Map() };
    const deps = {
      ctx: {} as AudioContext,
      seq: { bpm: 120 } as never,
      laneResources: { get: () => ({ engine: { id: 'poly', createVoice: () => fakeVoice }, strip: { input: {} } }) } as never,
    };
    const trigger = createTriggerForLane(deps);
    trigger('lane1', 60, 0, 0.2, false, false, undefined, 73);
    expect(seen).toEqual([73]);
  });
});

describe('createTriggerForLane note-FX integration', () => {
  beforeEach(() => { _resetNoteFxRegistry(); });

  it('with an empty chain, fires exactly the input note (passthrough)', () => {
    const fired: Array<{ note: number; time: number }> = [];
    const trigger = createTriggerForLane(fakeDeps(fired));
    trigger('sub-1', 60, 0, 1.0, false);
    expect(fired).toEqual([{ note: 60, time: 0 }]);
  });

  it('with a chord note-FX, fires the whole chord', () => {
    const fired: Array<{ note: number; time: number }> = [];
    const chain = getNoteFxChain('sub-1');
    const chord = chain.addNoteFx('chord');
    chord.params = { chordType: 'maj', octave: 0 };
    const trigger = createTriggerForLane(fakeDeps(fired));
    trigger('sub-1', 60, 0, 1.0, false);
    expect(fired.map((f) => f.note)).toEqual([60, 64, 67]);
  });
});

describe('trigger-dispatch onVoiceFired tap', () => {
  function fakeDepsTap(onVoiceFired?: (laneId: string, gateSec: number) => void) {
    const voice = { trigger() {}, release() {}, connect() {}, dispose() {}, getAudioParams: () => new Map() };
    const res = {
      engine: { id: 'subtractive', createVoice: () => voice },
      strip: { input: {} as AudioNode },
    };
    const laneResources = { get: (id: string) => (id === 'bass' ? res : undefined) } as any;
    return {
      ctx: {} as AudioContext,
      laneResources,
      seq: { bpm: 120 } as any,
      onVoiceFired,
    };
  }

  it('fires the tap with (laneId, gate) for each voice', () => {
    const seen: Array<[string, number]> = [];
    const trigger = createTriggerForLane(fakeDepsTap((l, g) => seen.push([l, g])));
    trigger('bass', 60, 0, 0.25, false);
    expect(seen).toEqual([['bass', 0.25]]);
  });

  it('does nothing when the lane has no resource', () => {
    const seen: Array<[string, number]> = [];
    const trigger = createTriggerForLane(fakeDepsTap((l, g) => seen.push([l, g])));
    trigger('missing', 60, 0, 0.25, false);
    expect(seen.length).toBe(0);
  });
});
