import { describe, it, expect } from 'vitest';
import { createTriggerForLane } from './trigger-dispatch';

describe('createTriggerForLane slice', () => {
  it('passes opts.slice to the voice and bypasses note-FX', () => {
    const triggered: Array<{ m: number; t: number; o: any }> = [];
    const fakeVoice = { trigger: (m: number, t: number, o: any) => triggered.push({ m, t, o }) };
    const res = { engine: { id: 'sampler', createVoice: () => fakeVoice }, strip: { input: {} } };
    const deps: any = {
      ctx: {}, seq: { bpm: 120 },
      laneResources: { get: (id: string) => (id === 'L1' ? res : undefined) },
    };
    const trig = createTriggerForLane(deps);
    trig('L1', 36, 0, 0.25, false, false, undefined, { sampleId: 'smp', start: 0.5, end: 1.0 });
    expect(triggered.length).toBe(1);
    expect(triggered[0].o.slice).toEqual({ sampleId: 'smp', start: 0.5, end: 1.0 });
  });
});
