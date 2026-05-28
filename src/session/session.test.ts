import { describe, it, expect } from 'vitest';
import { emptyScene, type SessionScene } from './session';

describe('SessionScene.presetPerLane', () => {
  it('is undefined by default on an empty scene', () => {
    const s = emptyScene('Scene 1');
    expect(s.presetPerLane).toBeUndefined();
  });

  it('accepts a laneId → preset-name map when set', () => {
    const s: SessionScene = {
      ...emptyScene('Scene 1'),
      presetPerLane: { 'subtractive-1': 'factory:PAD Warm' },
    };
    expect(s.presetPerLane?.['subtractive-1']).toBe('factory:PAD Warm');
  });
});
