import { describe, it, expect } from 'vitest';
import { collectSceneAutomation } from './collect-scene-automation';
import { tickSessionEnvelopes, emptyLanePlayState } from '../session/session-runtime';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { envelopeValueLength } from '../core/clip-envelope-length';
import { ticksPerBar, DEFAULT_METER, type TimeSignature } from '../core/meter';
import { TICKS_PER_STEP } from '../core/notes';
import type { SoundingLaneClip } from './collect-scene-triggers';

const THREE_FOUR: TimeSignature = { num: 3, den: 4 };

function lane(env: { paramId: string; values: number[]; enabled?: boolean }): SoundingLaneClip {
  return {
    laneId: 'sub', engineId: 'subtractive',
    clip: { color: '#e0b8b8', gridResolution: '1/16', id: 'c', lengthBars: 1, notes: [], envelopes: [env] },
  };
}

describe('collectSceneAutomation', () => {
  // bpm 120 → stepDur 0.125s, subDur = 0.125/16 = 0.0078125s.
  const values = Array.from({ length: 256 }, (_, i) => i / 255);

  it('strips the laneId prefix and samples at sub-step resolution', () => {
    // window = 1 step = 16 sub-steps
    const pts = collectSceneAutomation([lane({ paramId: 'sub.filter.cutoff', values })], 120, 0.125, DEFAULT_METER);
    expect(pts.length).toBe(16);
    expect(pts[0]).toMatchObject({ laneId: 'sub', paramId: 'filter.cutoff', time: 0 });
    expect(pts[0].normalised).toBeCloseTo(0);
    expect(pts[15].normalised).toBeCloseTo(15 / 255);
  });

  it('loops the envelope with % totalSubs (value wraps at the bar boundary)', () => {
    // 1 bar = 256 sub-steps = 2.0s. Sample just past it.
    const pts = collectSceneAutomation([lane({ paramId: 'sub.filter.cutoff', values })], 120, 2.05, DEFAULT_METER);
    const atBarStart = pts.find((p) => Math.abs(p.time - 2.0) < 0.004);
    expect(atBarStart?.normalised).toBeCloseTo(0, 5); // wrapped back to values[0]
  });

  it('skips disabled envelopes', () => {
    const pts = collectSceneAutomation([lane({ paramId: 'sub.filter.cutoff', values: [0.5], enabled: false })], 120, 0.5, DEFAULT_METER);
    expect(pts).toHaveLength(0);
  });

  it('returns nothing for a clip without envelopes', () => {
    const noEnv: SoundingLaneClip = { laneId: 'x', engineId: 'tb303', clip: { color: '#c8c8a8', gridResolution: '1/16', id: 'c', lengthBars: 1, notes: [] } };
    expect(collectSceneAutomation([noEnv], 120, 1, DEFAULT_METER)).toHaveLength(0);
  });
});

describe('collectSceneAutomation — the export plays what the live tick plays', () => {
  const bpm = 120;
  const stepDur = 60 / bpm / 4;
  const subDur = stepDur / AUTOMATION_SUB_RES;

  /** The two paths, sampled over the same window, compared against EACH OTHER —
   *  never against a constant. That is the whole point: an export that drifts
   *  from the live scheduler is a silently different recording. */
  function liveVsOffline(lengthBars: number, m: TimeSignature) {
    const len = envelopeValueLength(lengthBars, m);
    const values = Array.from({ length: len }, (_, i) => (i + 1) / (len + 1));
    const clip = { color: '#e0b8b8', gridResolution: '1/16' as const, id: 'c', lengthBars, notes: [],
      envelopes: [{ paramId: 'sub.filter.cutoff', values, enabled: true }] };
    // A window and a half of the clip's own loop, so the wrap is exercised.
    const lapSec = ((lengthBars * ticksPerBar(m)) / TICKS_PER_STEP) * stepDur;
    const windowSec = lapSec * 1.5;

    const offline = collectSceneAutomation([{ laneId: 'sub', engineId: 'subtractive', clip }], bpm, windowSec, m)
      .map((p) => p.normalised);

    const lp = emptyLanePlayState('sub');
    lp.playing = clip as never;
    lp.startTime = 0;
    const states = new Map([['sub', lp]]);
    const live = offline.map((_, i) => {
      let v = Number.NaN;
      // Mid-sub-step: the offline collector walks its own integer counter, so
      // sampling the live clock on the boundary would only test float luck.
      tickSessionEnvelopes(states, (i + 0.5) * subDur, bpm, m, (_id, n) => { v = n; });
      return v;
    });
    return { live, offline };
  }

  it('offline envelope indexing matches the live one in 3/4', () => {
    const { live, offline } = liveVsOffline(2, THREE_FOUR);
    expect(offline.length).toBeGreaterThan(envelopeValueLength(2, THREE_FOUR));
    expect(offline).toEqual(live);
  });

  it('…and in 4/4, which is what it already did', () => {
    const { live, offline } = liveVsOffline(2, DEFAULT_METER);
    expect(offline).toEqual(live);
  });
});
