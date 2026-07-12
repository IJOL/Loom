// src/control/control-mediator.input.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMediator } from './control-mediator';
import type { LoomControlFacade, SurfaceView } from './controller-profile';

function fakeFacade(over: Partial<LoomControlFacade> = {}): LoomControlFacade {
  const view: SurfaceView = {
    variant: 'mk1', cells: [], scenes: [], anyPlaying: false, activeLaneCol: null, knobBank: 'device',
  };
  return {
    playLiveNote: vi.fn(), releaseLiveNote: vi.fn(), setSustain: vi.fn(),
    launchClip: vi.fn(), launchScene: vi.fn(), stopAll: vi.fn(),
    startCapture: vi.fn(), stopCapture: vi.fn(), isCapturing: vi.fn(() => false), canCapture: vi.fn(() => false),
    engineParamIds: vi.fn(() => ['filter.cutoff', 'filter.resonance']),
    setEngineParam: vi.fn(), setLaneVolume: vi.fn(), setLanePan: vi.fn(), setLaneEq: vi.fn(),
    getActiveLane: vi.fn(() => 'lane-b'),
    setActiveLane: vi.fn(),
    laneIds: vi.fn(() => ['lane-a', 'lane-b', 'lane-c']),
    buildSurfaceView: vi.fn(() => view),
    onStateChange: vi.fn(() => () => {}),
    ...over,
  };
}

const profile = { render: () => [] } as any;

describe('mediator input mapping', () => {
  it('padPress launches the clip at viewport lane=col, clipIdx=row', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'padPress', col: 1, row: 2 });
    expect(f.launchClip).toHaveBeenCalledWith('lane-b', 2);
  });
  it('sceneLaunch + stopAll delegate', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'sceneLaunch', row: 3 });
    m.handle({ type: 'stopAll' });
    expect(f.launchScene).toHaveBeenCalledWith(3);
    expect(f.stopAll).toHaveBeenCalled();
  });
  it('notes go to the live keyboard on the active lane', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'noteOn', midi: 60, velocity: 88 });
    m.handle({ type: 'noteOff', midi: 60 });
    expect(f.playLiveNote).toHaveBeenCalledWith('lane-b', 60, 88);
    expect(f.releaseLiveNote).toHaveBeenCalledWith('lane-b', 60);
  });
  it('DEVICE bank knob writes the matching engine param of the active lane', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'knobBank', bank: 'device' });
    m.handle({ type: 'knob', index: 1, value01: 0.5 });
    expect(f.setEngineParam).toHaveBeenCalledWith('lane-b', 'filter.resonance', 0.5);
  });
  it('VOLUME bank knob i writes lane i volume', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'knobBank', bank: 'volume' });
    m.handle({ type: 'knob', index: 2, value01: 0.8 });
    expect(f.setLaneVolume).toHaveBeenCalledWith('lane-c', 0.8);
  });
  it('SEND bank knobs 0..2 write active-lane EQ low/mid/high', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'knobBank', bank: 'send' });
    m.handle({ type: 'knob', index: 0, value01: 0.5 });
    m.handle({ type: 'knob', index: 2, value01: 0.5 });
    expect(f.setLaneEq).toHaveBeenCalledWith('lane-b', 'low', 0.5);
    expect(f.setLaneEq).toHaveBeenCalledWith('lane-b', 'high', 0.5);
  });
  it('selectLane +1 moves the active lane to the next in laneIds', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'selectLane', delta: 1 });    // active lane-b (idx 1) → lane-c
    expect(f.setActiveLane).toHaveBeenCalledWith('lane-c');
  });
  it('sustain delegates', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'sustain', on: true });
    expect(f.setSustain).toHaveBeenCalledWith(true);
  });
});
