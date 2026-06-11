import { describe, it, expect } from 'vitest';
import { collectSceneAutomation } from './collect-scene-automation';
import type { SoundingLaneClip } from './collect-scene-triggers';

function lane(env: { paramId: string; values: number[]; enabled?: boolean }): SoundingLaneClip {
  return {
    laneId: 'sub', engineId: 'subtractive',
    clip: { id: 'c', lengthBars: 1, notes: [], envelopes: [env] },
  };
}

describe('collectSceneAutomation', () => {
  // bpm 120 → stepDur 0.125s, subDur = 0.125/16 = 0.0078125s.
  const values = Array.from({ length: 256 }, (_, i) => i / 255);

  it('strips the laneId prefix and samples at sub-step resolution', () => {
    // window = 1 step = 16 sub-steps
    const pts = collectSceneAutomation([lane({ paramId: 'sub.filter.cutoff', values })], 120, 0.125);
    expect(pts.length).toBe(16);
    expect(pts[0]).toMatchObject({ laneId: 'sub', paramId: 'filter.cutoff', time: 0 });
    expect(pts[0].normalised).toBeCloseTo(0);
    expect(pts[15].normalised).toBeCloseTo(15 / 255);
  });

  it('loops the envelope with % totalSubs (value wraps at the bar boundary)', () => {
    // 1 bar = 256 sub-steps = 2.0s. Sample just past it.
    const pts = collectSceneAutomation([lane({ paramId: 'sub.filter.cutoff', values })], 120, 2.05);
    const atBarStart = pts.find((p) => Math.abs(p.time - 2.0) < 0.004);
    expect(atBarStart?.normalised).toBeCloseTo(0, 5); // wrapped back to values[0]
  });

  it('skips disabled envelopes', () => {
    const pts = collectSceneAutomation([lane({ paramId: 'sub.filter.cutoff', values: [0.5], enabled: false })], 120, 0.5);
    expect(pts).toHaveLength(0);
  });

  it('returns nothing for a clip without envelopes', () => {
    const noEnv: SoundingLaneClip = { laneId: 'x', engineId: 'tb303', clip: { id: 'c', lengthBars: 1, notes: [] } };
    expect(collectSceneAutomation([noEnv], 120, 1)).toHaveLength(0);
  });
});
