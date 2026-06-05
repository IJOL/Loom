// src/control/loom-facade.ts
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import type { LoomControlFacade, SurfaceView, CellState, SceneState, KnobBank, Variant } from './controller-profile';
import { createLiveVoicePool } from './live-keyboard';
import type { ActiveLaneStore } from './active-lane';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';

export interface LoomFacadeDeps {
  ctx: AudioContext;
  sessionHost: SessionHost;
  laneResources: LaneResourceMap;
  activeLane: ActiveLaneStore;                 // bridged to SessionHost.activeEditLane in main.ts
  knobRegistry: Map<string, KnobHandle>;       // `${laneId}.${paramId}` → handle (automationRegistry)
}

const MAX_GAIN = 1.5;            // volume knob full-up
const EQ_DB = 12;               // ±12 dB at knob extremes

export function createLoomFacade(deps: LoomFacadeDeps): LoomControlFacade {
  const { ctx, sessionHost, laneResources, activeLane, knobRegistry } = deps;

  const pool = createLiveVoicePool({
    spawnVoice: (laneId) => {
      const res = laneResources.get(laneId);
      if (!res) return null;
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(ctx, res.strip.input);   // same path as trigger-dispatch
      setCurrentLaneForVoice(null);
      return v;
    },
    now: () => ctx.currentTime,
    defer: (fn) => setTimeout(fn, 300),
  });

  function setEngineParam(laneId: string, paramId: string, value01: number): void {
    const res = laneResources.get(laneId);
    if (!res) return;
    const spec = res.engine.params.find((p) => p.id === paramId);
    if (!spec || spec.kind !== 'continuous') return;
    const real = spec.min + value01 * (spec.max - spec.min);
    const handle = knobRegistry.get(`${laneId}.${paramId}`);
    if (handle) handle.setValue(real);          // moves the on-screen ring AND drives the engine
    else res.engine.setBaseValue(paramId, real);
  }

  function cellFor(laneId: string, clip: import('../session/session').SessionClip | null): CellState {
    if (!clip) return { kind: 'empty' };
    const lp = sessionHost.laneStates.get(laneId);
    if (lp?.playing && lp.playing.id === clip.id) return { kind: 'playing', color: clip.color };
    if (lp?.queued && lp.queued.id === clip.id) return { kind: 'queued-launch', color: clip.color };
    return { kind: 'stopped', color: clip.color };
  }

  function buildSurfaceView(variant: Variant, knobBank: KnobBank): SurfaceView {
    const lanes = sessionHost.state.lanes.slice(0, 8);
    const cells: CellState[][] = [];
    for (let row = 0; row < 5; row++) {
      const rowCells: CellState[] = [];
      for (let col = 0; col < 8; col++) {
        const lane = lanes[col];
        const clip = lane ? (lane.clips[row] ?? null) : null;
        rowCells.push(lane ? cellFor(lane.id, clip) : { kind: 'empty' });
      }
      cells.push(rowCells);
    }
    const scenes: SceneState[] = [];
    for (let row = 0; row < 5; row++) {
      const has = lanes.some((l) => l.clips[row] != null);
      scenes.push(has ? 'has-clips' : 'empty');
    }
    let anyPlaying = false;
    for (const lp of sessionHost.laneStates.values()) if (lp.playing) { anyPlaying = true; break; }
    const active = activeLane.get();
    const activeIdx = active ? lanes.findIndex((l) => l.id === active) : -1;
    return {
      variant, cells, scenes, anyPlaying,
      activeLaneCol: activeIdx >= 0 ? activeIdx : null,
      knobBank,
    };
  }

  return {
    playLiveNote: (laneId, midi, velocity) => pool.noteOn(laneId, midi, velocity),
    releaseLiveNote: (laneId, midi) => pool.noteOff(laneId, midi),
    setSustain: (on) => pool.setSustain(on),
    launchClip: (laneId, clipIdx) => sessionHost.launchClipAt(laneId, clipIdx),
    launchScene: (sceneIdx) => sessionHost.launchSceneAt(sceneIdx),
    stopAll: () => sessionHost.stopAllClips(),
    engineParamIds: (laneId) => {
      const res = laneResources.get(laneId);
      if (!res) return [];
      return res.engine.params.filter((p) => p.kind === 'continuous').slice(0, 8).map((p) => p.id);
    },
    setEngineParam,
    setLaneVolume: (laneId, v01) => laneResources.get(laneId)?.strip.setLevel(v01 * MAX_GAIN),
    setLanePan: (laneId, v01) => laneResources.get(laneId)?.strip.setPan(v01 * 2 - 1),
    setLaneEq: (laneId, band, v01) => {
      const strip = laneResources.get(laneId)?.strip;
      if (!strip) return;
      const db = (v01 * 2 - 1) * EQ_DB;
      if (band === 'low') strip.setEqLow(db);
      else if (band === 'mid') strip.setEqMid(db);
      else strip.setEqHigh(db);
    },
    getActiveLane: () => activeLane.get(),
    setActiveLane: (laneId) => { activeLane.set(laneId); sessionHost.focusLane(laneId); },
    laneIds: () => sessionHost.state.lanes.map((l) => l.id),
    buildSurfaceView,
    onStateChange: (cb) => {
      // The mixer/grid re-render is the natural "something changed" signal. We poll
      // a lightweight snapshot on a RAF-free interval is overkill; instead subscribe
      // to the active-lane store AND expose a manual refresh the host calls after
      // renderWithMixer. For v1 we hook the active-lane store + a periodic safety net.
      const off = activeLane.subscribe(() => cb());
      return off;
    },
  };
}
