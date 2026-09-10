// A scene launched from silence has to PLAY its first downbeat.
//
// The scene-launch anchor fix (4b7b437f) starts the transport BEFORE queuing
// the scene, so the sequencer's synchronous first tick sees an empty queue and
// the promotion waits for the first clock tick, >= 25 ms later. tickLane's
// window opens at `now - 1 µs`, so by then every note at tick 0 is in the past
// and is dropped — not late, gone. A scene launched into silence lost its
// downbeat on every lane, and the unit test that shipped with the fix could
// not see it: it promoted the queue by hand instead of through the clock.
//
// This drives the REAL Sequencer (main-thread fallback timer under fake
// timers), the real SessionHost tick and the real tickSession, and counts what
// actually reaches triggerForLane. The clip-launch path is the control: it
// queues first and starts second, and its downbeat has always sounded.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionHost } from './session-host';
import { tickSession } from './session-runtime';
import { Sequencer } from '../core/sequencer';
import { fakeDestinations } from './fake-destinations';
import type { SessionClip, SessionLane, SessionScene } from './session';

(globalThis as unknown as { document: { getElementById: () => null; querySelector: () => null; querySelectorAll: () => never[] } }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

const BPM = 130;
const BEAT = 60 / BPM;
const TICK_MS = 25;
/** 16 ticks = 0.4 s of clock; with the 0.2 s look-ahead the window reaches
 *  beat 2 (0.46 s) and stops well short of the next bar (1.85 s). */
const TICKS = 16;

/** One bar: a downbeat at tick 0 and a second hit on beat 2 (tick 96). */
const clip = (): SessionClip =>
  ({ id: 'd0', name: 'd0', color: '#fff', lengthBars: 1, gridResolution: '1/16',
     notes: [
       { start: 0, duration: 24, midi: 36, velocity: 115 },
       { start: 96, duration: 24, midi: 38, velocity: 100 },
     ] } as unknown as SessionClip);

interface Rig {
  host: SessionHost;
  seq: Sequencer;
  ctx: { currentTime: number };
  triggers: { midi: number; time: number }[];
  /** Advance the audio clock and the fallback timer together, one tick. */
  tick(): void;
}

function makeRig(): Rig {
  vi.useFakeTimers();
  const ctx = { currentTime: 3.4, state: 'running', resume: () => Promise.resolve() };
  const seq = new Sequencer(ctx as unknown as AudioContext);
  seq.bpm = BPM;
  const triggers: { midi: number; time: number }[] = [];
  const deps = {
    ctx,
    seq,
    bank: { slots: [] } as never,
    playBtn: { textContent: '', classList: { add: () => {}, remove: () => {} } } as never,
    resetAutomationPosition: () => {},
    triggerForLane: (_lane: string, midi: number, time: number) => { triggers.push({ midi, time }); },
    drumLanes: [],
    markTrackActive: () => {},
    ensureExtraPoly: () => ({}) as never,
    extraStrips: {},
    getLaneEngineId: () => 'drums-machine',
    ensureLaneVoice: () => null,
    showPolyEditor: () => {},
    setActiveEngineLane: () => {},
    polysynth: {} as never,
    mixerDeps: {} as never,
    midiLabel: () => '',
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
    destinations: fakeDestinations(),
  };
  const host = new SessionHost(deps as unknown as ConstructorParameters<typeof SessionHost>[0]);
  vi.spyOn(host, 'renderWithMixer').mockImplementation(() => {});
  // What `SessionHost.init()` hangs on the sequencer, minus the inspector it
  // also builds (DOM): every clock tick runs the real tickSession over the
  // host's own lane states. The promotion under test happens in there, driven
  // by the real Sequencer's tick order — nothing is promoted by hand.
  seq.sessionTick = (now, look) => {
    tickSession(host.laneStates, host.state, now, look, seq.bpm,
      (...args) => deps.triggerForLane(args[0], args[1], args[2]),
      () => {}, undefined, seq.meter, undefined, host.activeScene(), seq.swing);
  };
  host.state.lanes = [
    { id: 'drums', engineId: 'drums-machine', clips: [clip()], inserts: [] },
  ] as unknown as SessionLane[];
  host.state.scenes = [{ id: 's0', name: 'Scene 1', clipPerLane: {} } as unknown as SessionScene];
  host.state.globalQuantize = '1/1';
  return {
    host, seq, ctx, triggers,
    tick() {
      ctx.currentTime += TICK_MS / 1000;
      vi.advanceTimersByTime(TICK_MS);
    },
  };
}

afterEach(() => { vi.useRealTimers(); });

const at = (triggers: { midi: number; time: number }[], midi: number) =>
  triggers.filter((t) => t.midi === midi).map((t) => t.time);

describe('the first downbeat of a scene launched from silence', () => {
  it('reaches the trigger, at the transport s zero', () => {
    const rig = makeRig();
    rig.host.launchSceneAt(0);
    const zero = rig.seq.startedAtSec!;
    // Enough clock ticks for the 200 ms look-ahead to reach beat 2 (0.46 s).
    for (let i = 0; i < TICKS; i++) rig.tick();

    const downbeats = at(rig.triggers, 36);
    const beat2 = at(rig.triggers, 38);
    // The lane IS running — beat 2 arrives where it should…
    expect(beat2.length).toBe(1);
    expect(Math.abs(beat2[0] - (zero + BEAT))).toBeLessThan(1e-6);
    // …so a missing downbeat is a dropped note, not a lane that never started.
    expect(downbeats.length).toBe(1);
    expect(Math.abs(downbeats[0] - zero)).toBeLessThan(1e-6);
    rig.seq.stop();
  });

  it('after a Stop, the scene defines a FRESH zero — not the previous run s', () => {
    // The common case in practice: the transport has run before, so
    // `startedAtSec` is not null but STALE. Anchoring to it queued the scene on
    // the old run's bar grid; the downbeat has to land on this run's zero.
    const rig = makeRig();
    rig.host.launchClipAt('drums', 0);
    for (let i = 0; i < 4; i++) rig.tick();
    rig.seq.stop();
    rig.host.stopAllClips();
    const oldZero = rig.seq.startedAtSec!;
    rig.triggers.length = 0;
    // Land somewhere that is on no bar line of the old run.
    rig.ctx.currentTime = oldZero + 1.0;

    rig.host.launchSceneAt(0);
    const zero = rig.seq.startedAtSec!;
    expect(zero).not.toBe(oldZero);
    for (let i = 0; i < TICKS; i++) rig.tick();

    const downbeats = at(rig.triggers, 36);
    expect(downbeats.length).toBe(1);
    expect(Math.abs(downbeats[0] - zero)).toBeLessThan(1e-6);
    expect(Math.abs(downbeats[0] - (oldZero + 1.0))).toBeLessThan(1e-6);
    rig.seq.stop();
  });

  it('control: a single clip launched from silence has always played its downbeat', () => {
    const rig = makeRig();
    rig.host.launchClipAt('drums', 0);
    const zero = rig.seq.startedAtSec!;
    for (let i = 0; i < TICKS; i++) rig.tick();

    const downbeats = at(rig.triggers, 36);
    const beat2 = at(rig.triggers, 38);
    expect(beat2.length).toBe(1);
    expect(Math.abs(beat2[0] - (zero + BEAT))).toBeLessThan(1e-6);
    expect(downbeats.length).toBe(1);
    expect(Math.abs(downbeats[0] - zero)).toBeLessThan(1e-6);
    rig.seq.stop();
  });
});
