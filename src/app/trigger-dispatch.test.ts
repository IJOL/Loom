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
