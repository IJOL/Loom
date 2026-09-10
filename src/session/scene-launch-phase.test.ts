// Launching a SCENE from silence has to put the music's bar lines where the
// transport's zero is. Reported from the app: press any scene, stop the drums
// lane, press its clip again — "no entra al ritmo, va desacompasado".
//
// `launchClip`'s cold start anchors to `seq.startedAtSec` (see
// clip-launch-phase.test.ts). `launchSceneAt` used to read that anchor BEFORE
// `seq.start()` had written it, so the scene was queued on a grid counted from
// the AudioContext's own zero — page load — and the transport then started
// somewhere else entirely. Every later single-clip launch measured from the
// transport and entered a fraction of a bar off the material it joined.
import { describe, it, expect, vi } from 'vitest';
import { SessionHost } from './session-host';
import { fakeDestinations } from './fake-destinations';
import type { SessionClip, SessionLane, SessionScene } from './session';

(globalThis as unknown as { document: { getElementById: () => null; querySelector: () => null; querySelectorAll: () => never[] } }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

const BPM = 130;
const BAR = (4 * 60) / BPM;              // 1.846… s at 130

const clip = (id: string, lengthBars = 2): SessionClip =>
  ({ id, name: id, color: '#fff', lengthBars, notes: [], gridResolution: '1/16' } as unknown as SessionClip);

/** A stand-in for the real Sequencer: `startedAtSec` is null until `start()`,
 *  which stamps it with the audio clock — exactly as core/sequencer.ts does. */
function makeSeq(ctx: { currentTime: number }) {
  return {
    bpm: BPM,
    meter: { num: 4, den: 4 },
    sessionMode: true,
    startedAtSec: null as number | null,
    playing: false,
    isPlaying(): boolean { return this.playing; },
    start(): void {
      if (this.playing) return;
      this.playing = true;
      this.startedAtSec = ctx.currentTime;
    },
  };
}

function makeHost(ctx: { currentTime: number; resume: () => Promise<void> }, seq: ReturnType<typeof makeSeq>): SessionHost {
  const deps = {
    ctx,
    seq,
    bank: { slots: [] } as never,
    playBtn: { textContent: '', classList: { add: () => {}, remove: () => {} } } as never,
    resetAutomationPosition: () => {},
    triggerForLane: () => {},
    drumLanes: [],
    markTrackActive: () => {},
    ensureExtraPoly: () => ({}) as never,
    extraStrips: {},
    getLaneEngineId: () => 'subtractive',
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
  host.state.lanes = [
    { id: 'drums', engineId: 'drums-machine', clips: [clip('d0')], inserts: [] },
    { id: 'bass', engineId: 'tb303', clips: [clip('b0')], inserts: [] },
  ] as unknown as SessionLane[];
  host.state.scenes = [{ id: 's0', name: 'Scene 1', clipPerLane: {} } as unknown as SessionScene];
  host.state.globalQuantize = '1/1';
  return host;
}

/** What tickSession does when it crosses a lane's queued boundary. */
function promoteQueued(host: SessionHost): void {
  for (const lp of host.laneStates.values()) {
    if (!lp.queued) continue;
    lp.playing = lp.queued;
    lp.queued = null;
    lp.startTime = lp.queuedBoundary;
    lp.loopStartedAt = lp.queuedBoundary;
  }
}

describe('relaunching one lane s clip after a scene launch', () => {
  it('enters on a bar line of the music that is still playing', () => {
    // 3.4 s into the page, transport never run: the absolute grid sits at
    // 1.85, 3.69, 5.54… and nothing has put the music there.
    const ctx = { currentTime: 3.4, resume: () => Promise.resolve() };
    const seq = makeSeq(ctx);
    const host = makeHost(ctx, seq);

    host.launchSceneAt(0);
    promoteQueued(host);
    const bassAnchor = host.laneStates.get('bass')!.loopStartedAt;

    // Somewhere mid-phrase the drums are stopped and launched again.
    ctx.currentTime = bassAnchor + 3;
    const drums = host.laneStates.get('drums')!;
    drums.playing = null;
    drums.queued = null;
    host.launchClipAt('drums', 0);

    const at = host.laneStates.get('drums')!.queuedBoundary;
    const phase = ((at - bassAnchor) % BAR + BAR) % BAR;
    expect(Math.min(phase, BAR - phase)).toBeLessThan(BAR / 1000);
  });

  it('starts the scene at the transport s own zero, not a bar of dead air later', () => {
    const ctx = { currentTime: 3.4, resume: () => Promise.resolve() };
    const seq = makeSeq(ctx);
    const host = makeHost(ctx, seq);

    host.launchSceneAt(0);

    const at = host.laneStates.get('drums')!.queuedBoundary;
    expect(seq.startedAtSec).not.toBeNull();
    expect(Math.abs(at - seq.startedAtSec!)).toBeLessThan(1e-6);
  });
});
