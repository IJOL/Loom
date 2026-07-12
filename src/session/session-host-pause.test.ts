import { describe, it, expect, vi } from 'vitest';
import { SessionHost } from './session-host';
import type { LanePlayState } from './session-runtime';

(globalThis as unknown as { document: { getElementById: () => null; querySelector: () => null; querySelectorAll: () => never[] } }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

function makeHost(): SessionHost {
  const deps = {
    ctx: { currentTime: 0, resume: () => Promise.resolve() },
    seq: { bpm: 120, meter: { num: 4, den: 4 }, isPlaying: () => false, start: () => {}, sessionMode: true },
    bank: { slots: [] } as never,
    playBtn: { textContent: '' } as never,
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
  };
  return new SessionHost(deps as unknown as ConstructorParameters<typeof SessionHost>[0]);
}

describe('SessionHost — global pause/resume (Space)', () => {
  it('pauseTransport saves the exact position + scene and stops; resumeTransport relaunches + seeks back', () => {
    const host = makeHost();
    // Simulate a launched, playing transport at song position 4s (bar 2 @ 120bpm 4/4, barSec = 2s).
    host.activeSceneIdx = 0;
    host.songAnchorSec = 0;
    host.laneStates.set('l1', { laneId: 'l1', playing: {} } as unknown as LanePlayState);
    (host as unknown as { deps: { ctx: { currentTime: number } } }).deps.ctx.currentTime = 4;

    const stopAllClips = vi.spyOn(host, 'stopAllClips').mockImplementation(() => {});
    host.pauseTransport();
    expect(stopAllClips).toHaveBeenCalledTimes(1);

    // Resume: exact seek back to the saved bar (2) on the same scene (0).
    const launchSceneAt = vi.spyOn(host, 'launchSceneAt').mockImplementation(() => {});
    const seekToBar = vi.spyOn(host, 'seekToBar').mockImplementation(() => {});
    host.resumeTransport();
    expect(launchSceneAt).toHaveBeenCalledWith(0);
    expect(seekToBar).toHaveBeenCalledWith(2);
  });

  it('togglePlayPause is a no-op when nothing is playing', () => {
    const host = makeHost();
    host.activeSceneIdx = -1;   // never launched
    const stopAllClips = vi.spyOn(host, 'stopAllClips').mockImplementation(() => {});
    const launchSceneAt = vi.spyOn(host, 'launchSceneAt').mockImplementation(() => {});
    host.togglePlayPause();
    expect(stopAllClips).not.toHaveBeenCalled();
    expect(launchSceneAt).not.toHaveBeenCalled();
  });

  it('togglePlayPause pauses when playing, then resumes from the saved position', () => {
    const host = makeHost();
    host.activeSceneIdx = 0;
    host.songAnchorSec = 0;
    host.laneStates.set('l1', { laneId: 'l1', playing: {} } as unknown as LanePlayState);
    (host as unknown as { deps: { ctx: { currentTime: number } } }).deps.ctx.currentTime = 2;  // bar 1
    vi.spyOn(host, 'stopAllClips').mockImplementation(() => {
      host.laneStates.get('l1')!.playing = null;   // reflect the stop
    });
    const launchSceneAt = vi.spyOn(host, 'launchSceneAt').mockImplementation(() => {});
    const seekToBar = vi.spyOn(host, 'seekToBar').mockImplementation(() => {});

    host.togglePlayPause();                          // playing → pause
    expect(host.laneStates.get('l1')!.playing).toBeNull();
    host.togglePlayPause();                          // paused → resume
    expect(launchSceneAt).toHaveBeenCalledWith(0);
    expect(seekToBar).toHaveBeenCalledWith(1);
  });
});
