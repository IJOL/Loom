// src/control/control-mediator.led.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMediator } from './control-mediator';
import type { LoomControlFacade, SurfaceView, ControllerProfile } from './controller-profile';

function view(over: Partial<SurfaceView> = {}): SurfaceView {
  return { variant: 'mk1', cells: [], scenes: [], anyPlaying: false, activeLaneCol: null, knobBank: 'device', ...over };
}

function facadeWithStateHook(): { facade: LoomControlFacade; fire: () => void } {
  let cb: () => void = () => {};
  const facade = {
    playLiveNote: vi.fn(), releaseLiveNote: vi.fn(), setSustain: vi.fn(),
    launchClip: vi.fn(), launchScene: vi.fn(), stopAll: vi.fn(),
    engineParamIds: vi.fn(() => []), setEngineParam: vi.fn(),
    setLaneVolume: vi.fn(), setLanePan: vi.fn(), setLaneEq: vi.fn(),
    getActiveLane: vi.fn(() => null), setActiveLane: vi.fn(), laneIds: vi.fn(() => []),
    buildSurfaceView: vi.fn(() => view()),
    onStateChange: (fn: () => void) => { cb = fn; return () => {}; },
  } as unknown as LoomControlFacade;
  return { facade, fire: () => cb() };
}

const profile = {
  render: (v: SurfaceView) => [
    { key: 'stopall', data: [0x90, 81, v.anyPlaying ? 3 : 0] },
  ],
} as unknown as ControllerProfile;

describe('mediator LED output', () => {
  it('a facade state change triggers a render and sends LED bytes', () => {
    const { facade, fire } = facadeWithStateHook();
    const sent: number[][] = [];
    createMediator({ facade, profile, send: (b) => sent.push(b), variant: 'mk1' });
    fire();
    expect(sent).toContainEqual([0x90, 81, 0]);
  });

  it('only sends a LED whose bytes changed (delta)', () => {
    const { facade, fire } = facadeWithStateHook();
    const sent: number[][] = [];
    let playing = false;
    (facade.buildSurfaceView as any) = vi.fn(() => view({ anyPlaying: playing }));
    const m = createMediator({ facade, profile, send: (b) => sent.push(b), variant: 'mk1' });
    m.refreshLeds();                 // sends [0x90,81,0]
    m.refreshLeds();                 // unchanged → no new send
    playing = true;
    m.refreshLeds();                 // changed → sends [0x90,81,3]
    expect(sent).toEqual([[0x90, 81, 0], [0x90, 81, 3]]);
    void fire;
  });
});
