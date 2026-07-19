// src/export/collect-scene-triggers.test.ts
import { describe, it, expect } from 'vitest';
import { collectSceneTriggers } from './collect-scene-triggers';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

const clip = (id: string, lengthBars: number, notes: SessionClip['notes']): SessionClip =>
  ({ color: '#c8a8e0', gridResolution: '1/16', id, lengthBars, notes });

describe('collectSceneTriggers', () => {
  it('emits one trigger per note for a single-bar clip rendered once', () => {
    // 1 bar @120 4/4 = 2s. Notes at tick 0 (→0s) and tick 48 (→0.25s @120).
    const c = clip('a', 1, [
      { start: 0, duration: 24, midi: 60, velocity: 80 },
      { start: 48, duration: 24, midi: 64, velocity: 110 },
    ]);
    const triggers = collectSceneTriggers(
      [{ laneId: 'L', engineId: 'subtractive', clip: c }],
      120, DEFAULT_METER, 2.0,
    );
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toMatchObject({ laneId: 'L', midi: 60, accent: false });
    expect(triggers[0].time).toBeCloseTo(0, 6);
    expect(triggers[1]).toMatchObject({ midi: 64, accent: true });
    expect(triggers[1].time).toBeCloseTo(0.25, 6); // tick 48 / 96 * (60/120)
  });

  it('loops a shorter clip to fill the window', () => {
    // 1-bar (2s) clip, window 4s → note fires at 0s and 2s.
    const c = clip('a', 1, [{ start: 0, duration: 24, midi: 60, velocity: 80 }]);
    const triggers = collectSceneTriggers(
      [{ laneId: 'L', engineId: 'subtractive', clip: c }], 120, DEFAULT_METER, 4.0,
    );
    expect(triggers.map((t) => Number(t.time.toFixed(3)))).toEqual([0, 2]);
  });

  it('sorts triggers across lanes by time', () => {
    const a = clip('a', 1, [{ start: 24, duration: 24, midi: 60, velocity: 80 }]); // 0.125s
    const b = clip('b', 1, [{ start: 0, duration: 24, midi: 40, velocity: 80 }]);  // 0.0s
    const triggers = collectSceneTriggers(
      [{ laneId: 'A', engineId: 'subtractive', clip: a },
       { laneId: 'B', engineId: 'tb303', clip: b }],
      120, DEFAULT_METER, 2.0,
    );
    expect(triggers.map((t) => t.laneId)).toEqual(['B', 'A']);
  });
});
