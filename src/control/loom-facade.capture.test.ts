// src/control/loom-facade.capture.test.ts
// Task 5: facade loop-record capture — destination resolution, playhead
// anchoring, undoable commit. No `loom-facade.test.ts` exists yet in this
// codebase (confirmed before writing this file — see task-5-report.md), so
// the stub fixtures below are built directly against the real SessionHost /
// SessionInspector / SessionLane shapes rather than adapted from a prior file.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoomFacade, type LoomFacadeDeps } from './loom-facade';
import { createActiveLaneStore } from './active-lane';
import { createDestinationRegistry } from '../automation/destination-registry';
import type { SessionClip, SessionLane } from '../session/session';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import type { TimeSignature } from '../core/meter';
import type { HistoryDeps } from '../save/history-wiring';

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
  const launchClipAt = vi.fn((laneId: string, clipIdx: number) => {
    // Mirror the production effect: the launched clip becomes the one playing on
    // its lane with a real loopStartedAt, so posTicksFor() has a playhead to
    // measure against (otherwise captured notes pile at tick 0).
    const lane = opts.lanes.find((l) => l.id === laneId);
    const clip = lane?.clips[clipIdx];
    if (clip) laneStates.set(laneId, { laneId, playing: clip, loopStartedAt: 0 });
  });
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
    launchClipAt,
    renderWithMixer,
  };
  return { host: stub as unknown as SessionHost, launchSceneAt, launchClipAt, renderWithMixer, refreshOpenEditor };
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
    destinations: createDestinationRegistry({ getState: () => host.state, getKnobRegistry: () => new Map() }),
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

  it('(e) another lane playing but the destination lane is idle: launches just the destination clip so notes anchor to the playhead (no tick-0 pileup)', () => {
    const dest: SessionClip = { id: 'clip-1', lengthBars: 2, notes: [], color: '#fff' };
    const sub: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [dest] };
    const drumsClip: SessionClip = { id: 'clip-d', lengthBars: 1, notes: [], color: '#000' };
    const drums: SessionLane = { id: 'drums', engineId: 'drums-machine', clips: [drumsClip] };
    const ctx = makeCtx(0);
    panelHidden = false;
    const { host, launchSceneAt, launchClipAt } = makeHostStub({
      lanes: [drums, sub],
      selected: { laneId: 'sub', clipIdx: 0 },
      playing: { drums: drumsClip },          // drums is looping; the destination lane 'sub' is idle
      loopStartedAt: { drums: 0 },
    });
    const f = createLoomFacade(makeDeps(host, { ctx, bpm: 120 }));

    f.startCapture('replace');

    // The whole scene is NOT relaunched (never disturb the running transport),
    // but the destination clip IS launched so 'sub' gets a real loopStartedAt.
    expect(launchSceneAt).not.toHaveBeenCalled();
    expect(launchClipAt).toHaveBeenCalledWith('sub', 0);

    (ctx as unknown as { currentTime: number }).currentTime = 0.5;   // -> 96 ticks
    f.playLiveNote('sub', 64, 100);
    (ctx as unknown as { currentTime: number }).currentTime = 1.0;   // -> 192 ticks
    f.releaseLiveNote('sub', 64);
    f.stopCapture();

    // The captured note anchors to the real playhead (96), NOT piled at tick 0.
    expect(dest.notes).toEqual([{ start: 96, duration: 96, midi: 64, velocity: 100 }]);
  });

  it('(f) count-in: startCapture from idle defers recording until the count-in completes', () => {
    const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [] };
    const { host, launchSceneAt } = makeHostStub({ lanes: [lane] });
    let onDone: (() => void) | null = null;
    const cancel = vi.fn();
    const countIn = vi.fn((_bars: number, _bpm: number, _meter: TimeSignature, cb: () => void) => { onDone = cb; return cancel; });
    const f = createLoomFacade({ ...makeDeps(host, { activeLaneId: 'sub' }), countIn });

    f.startCapture('merge');
    expect(countIn).toHaveBeenCalled();
    expect(launchSceneAt).not.toHaveBeenCalled();   // NOT launched during the count-in
    expect(f.isCapturing()).toBe(true);             // armed (button shows ■ Stop)

    onDone!();                                       // count-in ends
    expect(launchSceneAt).toHaveBeenCalledWith(0);   // recording begins now
  });

  it('(g) stopCapture during the count-in cancels it and drops the placed clip', () => {
    const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [] };
    const { host, launchSceneAt } = makeHostStub({ lanes: [lane] });
    const cancel = vi.fn();
    const countIn = vi.fn((_bars: number, _bpm: number, _meter: TimeSignature, _cb: () => void) => cancel);
    const f = createLoomFacade({ ...makeDeps(host, { activeLaneId: 'sub' }), countIn });

    f.startCapture('merge');
    expect(lane.clips[0]).not.toBeNull();            // clip placed during the count-in
    f.stopCapture();
    expect(cancel).toHaveBeenCalled();               // metronome cancelled
    expect(lane.clips[0] ?? null).toBeNull();        // placeholder dropped
    expect(launchSceneAt).not.toHaveBeenCalled();
    expect(f.isCapturing()).toBe(false);
  });

  it('(h) live: a captured note lands in clip.notes on release, BEFORE stopCapture (real-time grid)', () => {
    const dest: SessionClip = { id: 'clip-1', lengthBars: 2, notes: [], color: '#fff' };
    const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [dest] };
    const ctx = makeCtx(0);
    panelHidden = false;
    const { host } = makeHostStub({
      lanes: [lane],
      selected: { laneId: 'sub', clipIdx: 0 },
      playing: { sub: dest },
      loopStartedAt: { sub: 0 },
    });
    const f = createLoomFacade(makeDeps(host, { ctx, bpm: 120 }));

    f.startCapture('merge');
    (ctx as unknown as { currentTime: number }).currentTime = 0.5;   // -> 96 ticks
    f.playLiveNote('sub', 64, 100);
    (ctx as unknown as { currentTime: number }).currentTime = 1.0;   // -> 192 ticks
    f.releaseLiveNote('sub', 64);

    // The RAF loop redraws the piano-roll from clip.notes every frame, so the
    // note must already be present the instant the key is released — not only
    // after stopCapture(). This is the whole point of the real-time-grid fix.
    expect(dest.notes).toEqual([{ start: 96, duration: 96, midi: 64, velocity: 100 }]);

    f.stopCapture();
    // stop() is authoritative and must NOT double-count the live-appended note.
    expect(dest.notes).toEqual([{ start: 96, duration: 96, midi: 64, velocity: 100 }]);
  });

  it('(i) brackets the whole capture in ONE undo gesture (beginGesture at start, endGesture at stop)', () => {
    const dest: SessionClip = { id: 'clip-1', lengthBars: 2, notes: [], color: '#fff' };
    const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [dest] };
    const ctx = makeCtx(0);
    panelHidden = false;
    const { host } = makeHostStub({
      lanes: [lane],
      selected: { laneId: 'sub', clipIdx: 0 },
      playing: { sub: dest },
      loopStartedAt: { sub: 0 },
    });
    const beginGesture = vi.fn();
    const endGesture = vi.fn();
    const historyDeps = { beginGesture, endGesture } as unknown as HistoryDeps;
    const f = createLoomFacade({ ...makeDeps(host, { ctx, bpm: 120 }), historyDeps });

    f.startCapture('merge');
    expect(beginGesture).toHaveBeenCalledTimes(1);
    expect(endGesture).not.toHaveBeenCalled();       // still recording

    (ctx as unknown as { currentTime: number }).currentTime = 0.5;
    f.playLiveNote('sub', 64, 100);
    (ctx as unknown as { currentTime: number }).currentTime = 1.0;
    f.releaseLiveNote('sub', 64);
    // A held-key release must not close the gesture — only stopCapture does.
    expect(endGesture).not.toHaveBeenCalled();

    f.stopCapture();
    expect(endGesture).toHaveBeenCalledTimes(1);      // one undo step for the whole take
    expect(beginGesture).toHaveBeenCalledTimes(1);
  });
});
