// src/control/loom-facade.capture.test.ts
// Task 5: facade loop-record capture — destination resolution, playhead
// anchoring, undoable commit. No `loom-facade.test.ts` exists yet in this
// codebase (confirmed before writing this file — see task-5-report.md), so
// the stub fixtures below are built directly against the real SessionHost /
// SessionInspector / SessionLane shapes rather than adapted from a prior file.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoomFacade, type LoomFacadeDeps } from './loom-facade';
import { createActiveLaneStore } from './active-lane';
import type { SessionClip, SessionLane } from '../session/session';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';

// createLoomFacade's resolveDestination() reads document.getElementById('session-inspector')
// to test whether the inspector panel is shown. Vitest runs this file under
// Node (environment: 'node' in vitest.config.ts) — no real DOM — so stub the
// one call the facade makes, same pattern as session-host-active-lane.test.ts.
let panelHidden = true;
(globalThis as unknown as {
  document: { getElementById: (id: string) => { hidden: boolean } | null };
}).document = {
  getElementById: (id) => (id === 'session-inspector' ? { hidden: panelHidden } : null),
};

interface FakeLanePlayState { laneId: string; playing: SessionClip | null; loopStartedAt: number; }

function makeCtx(initial = 0): AudioContext {
  let t = initial;
  return {
    get currentTime() { return t; },
    set currentTime(v: number) { t = v; },
    resume: () => Promise.resolve(),
  } as unknown as AudioContext;
}

function makeHostStub(opts: {
  lanes: SessionLane[];
  selected?: { laneId: string; clipIdx: number } | null;
  playing?: Record<string, SessionClip>;       // laneId -> the clip currently playing on it
  loopStartedAt?: Record<string, number>;
}) {
  const laneStates = new Map<string, FakeLanePlayState>();
  for (const laneId of Object.keys(opts.playing ?? {})) {
    laneStates.set(laneId, {
      laneId,
      playing: opts.playing![laneId],
      loopStartedAt: opts.loopStartedAt?.[laneId] ?? 0,
    });
  }
  const launchSceneAt = vi.fn();
  const renderWithMixer = vi.fn();
  const refreshOpenEditor = vi.fn();
  const stub = {
    state: { lanes: opts.lanes, scenes: [], globalQuantize: '1/1' as const },
    laneStates,
    inspector: {
      getSelectedClip: () => opts.selected ?? null,
      refreshOpenEditor,
    },
    launchSceneAt,
    renderWithMixer,
  };
  return { host: stub as unknown as SessionHost, launchSceneAt, renderWithMixer, refreshOpenEditor };
}

function makeDeps(
  host: SessionHost,
  opts: { ctx?: AudioContext; activeLaneId?: string | null; bpm?: number } = {},
): LoomFacadeDeps {
  const activeLane = createActiveLaneStore();
  if (opts.activeLaneId) activeLane.set(opts.activeLaneId);
  return {
    ctx: opts.ctx ?? makeCtx(),
    sessionHost: host,
    laneResources: { get: () => undefined } as unknown as LaneResourceMap,
    activeLane,
    knobRegistry: new Map<string, KnobHandle>(),
    seq: { bpm: opts.bpm ?? 120, meter: { num: 4, den: 4 }, isPlaying: () => false } as unknown as Sequencer,
  };
}

describe('loom-facade — loop-record capture', () => {
  beforeEach(() => { panelHidden = true; });

  it('(a) no clip open + idle transport: creates a new clip in the active lane and launches its scene', () => {
    const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [] };
    const { host, launchSceneAt } = makeHostStub({ lanes: [lane] });
    const f = createLoomFacade(makeDeps(host, { activeLaneId: 'sub' }));

    f.startCapture('merge');

    expect(lane.clips[0]).not.toBeNull();
    expect(lane.clips[0]?.lengthBars).toBe(1);
    expect(lane.clips[0]?.notes).toEqual([]);
    expect(launchSceneAt).toHaveBeenCalledWith(0);
  });

  it('(b) something already playing: does not launch the scene', () => {
    const existing: SessionClip = { id: 'clip-1', lengthBars: 1, notes: [], color: '#fff' };
    const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [existing] };
    const drumsClip: SessionClip = { id: 'clip-d', lengthBars: 1, notes: [], color: '#000' };
    panelHidden = false;
    const { host, launchSceneAt } = makeHostStub({
      lanes: [lane],
      selected: { laneId: 'sub', clipIdx: 0 },
      playing: { drums: drumsClip },
    });
    const f = createLoomFacade(makeDeps(host));

    f.startCapture('merge');

    expect(launchSceneAt).not.toHaveBeenCalled();
    f.stopCapture();
  });

  it('(c) open audio clip: canCapture() is false and startCapture is a no-op', () => {
    const audioClip: SessionClip = {
      id: 'clip-a', lengthBars: 1, notes: [], color: '#fff',
      sample: { sampleId: 's1', mode: 'loop', trimStart: 0, trimEnd: 1 },
    };
    const lane: SessionLane = { id: 'aud', engineId: 'audio', clips: [audioClip] };
    panelHidden = false;
    const { host, launchSceneAt } = makeHostStub({ lanes: [lane], selected: { laneId: 'aud', clipIdx: 0 } });
    const f = createLoomFacade(makeDeps(host));

    expect(f.canCapture()).toBe(false);
    f.startCapture('merge');

    expect(f.isCapturing()).toBe(false);
    expect(launchSceneAt).not.toHaveBeenCalled();
  });

  it('(d) full round-trip: startCapture(replace) -> playLiveNote/releaseLiveNote -> stopCapture commits notes', () => {
    const existing: SessionClip = {
      id: 'clip-1', lengthBars: 2, notes: [{ start: 0, duration: 10, midi: 40, velocity: 80 }], color: '#fff',
    };
    const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [existing] };
    const ctx = makeCtx(0);
    panelHidden = false;
    const { host } = makeHostStub({
      lanes: [lane],
      selected: { laneId: 'sub', clipIdx: 0 },
      playing: { sub: existing },       // lane is playing so posTicksFor computes a real playhead position
      loopStartedAt: { sub: 0 },
    });
    const f = createLoomFacade(makeDeps(host, { ctx, bpm: 120 }));

    f.startCapture('replace');
    expect(f.isCapturing()).toBe(true);

    (ctx as unknown as { currentTime: number }).currentTime = 0.5;   // 0.5s @ 120bpm, 96 ticks/quarter -> 96 ticks
    f.playLiveNote('sub', 64, 100);
    (ctx as unknown as { currentTime: number }).currentTime = 1.0;   // -> 192 ticks
    f.releaseLiveNote('sub', 64);

    f.stopCapture();

    // 'replace' mode drops the pre-existing note; only the captured one remains.
    expect(existing.notes).toEqual([{ start: 96, duration: 96, midi: 64, velocity: 100 }]);
    expect(f.isCapturing()).toBe(false);
  });
});
