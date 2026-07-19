import { describe, it, expect } from 'vitest';
import { reconcileLaneEnvelopes } from './session';
import type { SessionLane } from './session';

function laneWithEnv(paramId: string): SessionLane {
  return { inserts: [],
    id: 'L',
    engineId: 'subtractive',
    clips: [
      { color: '#c8c8a8', gridResolution: '1/16',
        id: 'c1',
        lengthBars: 1,
        notes: [],
        envelopes: [{ paramId, values: [0, 1], enabled: true }],
      },
    ],
  };
}

describe('reconcileLaneEnvelopes', () => {
  it('disables envelopes whose paramId is absent from the new engine set', () => {
    const lane = laneWithEnv('osc1.level');
    reconcileLaneEnvelopes(lane, new Set(['filter.cutoff']));
    expect(lane.clips[0]!.envelopes![0].enabled).toBe(false);
  });

  it('keeps (enables) envelopes whose paramId is shared', () => {
    const lane = laneWithEnv('filter.cutoff');
    reconcileLaneEnvelopes(lane, new Set(['filter.cutoff']));
    expect(lane.clips[0]!.envelopes![0].enabled).toBe(true);
  });

  it('no-ops on clips without envelopes and on null clip slots', () => {
    const lane: SessionLane = { inserts: [],
      id: 'L',
      engineId: 'fm',
      clips: [null, { color: '#f4b8b8', gridResolution: '1/16', id: 'c', lengthBars: 1, notes: [] }],
    };
    expect(() => reconcileLaneEnvelopes(lane, new Set())).not.toThrow();
  });
});
