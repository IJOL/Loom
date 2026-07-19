import { describe, it, expect } from 'vitest';
import { propagateLoopToSceneClips, copyLoopToClip, resolveSceneClip } from './scene-loop-link';
import { DEFAULT_METER, ticksPerBar } from './meter';
import type { SessionClip, SessionLane, SessionScene, SessionState } from '../session/session';

const bar = ticksPerBar(DEFAULT_METER); // 384

function makeClip(id: string, lengthBars: number, over: Partial<SessionClip> = {}): SessionClip {
  return { id, lengthBars, notes: [], color: '#a8c8e8', gridResolution: '1/16', ...over };
}

function makeLane(id: string, clips: (SessionClip | null)[]): SessionLane {
  return { inserts: [], id, engineId: 'tb303', clips };
}

// ── copyLoopToClip ─────────────────────────────────────────────────────────

describe('copyLoopToClip', () => {
  it('copies loopEnabled + ticks clamped to dst length', () => {
    const dst = makeClip('dst', 2); // 2 bars = 2*384 = 768 ticks
    copyLoopToClip({ loopEnabled: true, loopStartTick: 100, loopEndTick: 500 }, dst, DEFAULT_METER);
    expect(dst.loopEnabled).toBe(true);
    expect(dst.loopStartTick).toBe(100);
    expect(dst.loopEndTick).toBe(500);
  });

  it('clamps loopEndTick to dst total when src end exceeds it', () => {
    const dst = makeClip('dst', 1); // 1 bar = 384 ticks
    copyLoopToClip({ loopEnabled: true, loopStartTick: 0, loopEndTick: 1000 }, dst, DEFAULT_METER);
    expect(dst.loopEndTick).toBe(384); // clamped to 1*bar
  });

  it('clamps loopStartTick to 0 when src start is negative', () => {
    const dst = makeClip('dst', 2);
    copyLoopToClip({ loopEnabled: true, loopStartTick: -50, loopEndTick: 200 }, dst, DEFAULT_METER);
    expect(dst.loopStartTick).toBe(0);
  });

  it('loopEnabled=false propagates disabled state', () => {
    const dst = makeClip('dst', 4, { loopEnabled: true, loopStartTick: 50, loopEndTick: 200 });
    copyLoopToClip({ loopEnabled: false, loopStartTick: 0, loopEndTick: bar }, dst, DEFAULT_METER);
    expect(dst.loopEnabled).toBe(false);
  });
});

// ── resolveSceneClip ───────────────────────────────────────────────────────

describe('resolveSceneClip', () => {
  it('uses clipPerLane when explicit', () => {
    const clipA = makeClip('a', 4);
    const clipB = makeClip('b', 4);
    const lane = makeLane('l1', [clipA, clipB]);
    const scene: SessionScene = { id: 's', clipPerLane: { l1: 1 } };
    expect(resolveSceneClip(scene, 0, lane)).toBe(clipB);
  });

  it('falls back to sceneIdx when not in clipPerLane', () => {
    const clipA = makeClip('a', 4);
    const lane = makeLane('l1', [clipA]);
    const scene: SessionScene = { id: 's', clipPerLane: {} };
    expect(resolveSceneClip(scene, 0, lane)).toBe(clipA);
  });

  it('returns null for explicit null mapping', () => {
    const lane = makeLane('l1', [makeClip('a', 4)]);
    const scene: SessionScene = { id: 's', clipPerLane: { l1: null } };
    expect(resolveSceneClip(scene, 0, lane)).toBeNull();
  });

  it('returns null when no clip at resolved index', () => {
    const lane = makeLane('l1', []);
    const scene: SessionScene = { id: 's', clipPerLane: {} };
    expect(resolveSceneClip(scene, 2, lane)).toBeNull();
  });
});

// ── propagateLoopToSceneClips ──────────────────────────────────────────────

describe('propagateLoopToSceneClips', () => {
  it('propagates loop from srcClip to all other clips in the scene', () => {
    // 3 lanes, each with a clip at row 0; scene uses row-index fallback
    const clipA = makeClip('a', 4); // src: 4-bar, loop bars 1..3
    const clipB = makeClip('b', 2); // dst: 2-bar (will clamp)
    const clipC = makeClip('c', 8); // dst: 8-bar (loop fits)

    clipA.loopEnabled    = true;
    clipA.loopStartTick  = bar;       // bar 1
    clipA.loopEndTick    = 3 * bar;   // bar 3

    const laneA = makeLane('lA', [clipA]);
    const laneB = makeLane('lB', [clipB]);
    const laneC = makeLane('lC', [clipC]);

    const scene: SessionScene = { id: 's0', clipPerLane: {} };
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [laneA, laneB, laneC],
      scenes: [scene],
      globalQuantize: '1/1',
    };

    propagateLoopToSceneClips(state, scene, 0, clipA, DEFAULT_METER);

    // clipB (2-bar = 768 ticks): loopEndTick 3*384=1152 exceeds 2*384=768 → clamped
    expect(clipB.loopEnabled).toBe(true);
    expect(clipB.loopStartTick).toBe(bar);   // 384 fits in 768
    expect(clipB.loopEndTick).toBe(2 * bar); // 1152 clamped to 768

    // clipC (8-bar = 3072 ticks): loopStartTick and loopEndTick both fit
    expect(clipC.loopEnabled).toBe(true);
    expect(clipC.loopStartTick).toBe(bar);
    expect(clipC.loopEndTick).toBe(3 * bar);

    // srcClip itself is unchanged (same object, not re-copied)
    expect(clipA.loopStartTick).toBe(bar);
    expect(clipA.loopEndTick).toBe(3 * bar);
  });

  it('does NOT touch clips in a different scene', () => {
    const clipA = makeClip('a', 4, { loopEnabled: true, loopStartTick: bar, loopEndTick: 2 * bar });
    const clipX = makeClip('x', 4); // sits at row 1 → not in scene 0

    const laneA = makeLane('lA', [clipA, clipX]); // row0=clipA, row1=clipX
    const laneB = makeLane('lB', [makeClip('b', 4)]);

    const scene0: SessionScene = { id: 's0', clipPerLane: {} }; // sceneIdx=0
    const scene1: SessionScene = { id: 's1', clipPerLane: {} }; // sceneIdx=1

    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [laneA, laneB],
      scenes: [scene0, scene1],
      globalQuantize: '1/1',
    };

    // Propagate within scene0 (sceneIdx=0) from clipA
    propagateLoopToSceneClips(state, scene0, 0, clipA, DEFAULT_METER);

    // clipX at row1 is NOT in scene0 (sceneIdx=0 resolves laneA→clipA, laneB→row0)
    // clipX has never been touched
    expect(clipX.loopEnabled).toBeUndefined();
  });

  it('link toggle ON triggers propagation; OFF leaves clips as-is', () => {
    // Simulates the host calling propagate on link-ON, nothing on link-OFF
    const src = makeClip('src', 4, { loopEnabled: true, loopStartTick: 0, loopEndTick: 2 * bar });
    const dst = makeClip('dst', 4); // no loop set initially

    const scene: SessionScene = { id: 's', clipPerLane: {} };
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [makeLane('lSrc', [src]), makeLane('lDst', [dst])],
      scenes: [scene],
      globalQuantize: '1/1',
    };

    // Link ON → propagate
    scene.loopLinked = true;
    propagateLoopToSceneClips(state, scene, 0, src, DEFAULT_METER);
    expect(dst.loopEnabled).toBe(true);
    expect(dst.loopStartTick).toBe(0);
    expect(dst.loopEndTick).toBe(2 * bar);

    // Now change dst's loop manually
    dst.loopStartTick = bar;
    dst.loopEndTick = 3 * bar;

    // Link OFF → no propagation call, dst keeps its own values
    scene.loopLinked = false;
    // (host would NOT call propagateLoopToSceneClips here)
    expect(dst.loopStartTick).toBe(bar);
    expect(dst.loopEndTick).toBe(3 * bar);
  });
});
