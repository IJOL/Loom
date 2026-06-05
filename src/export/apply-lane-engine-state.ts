// src/export/apply-lane-engine-state.ts
// Apply a lane's persisted engineState onto an engine instance. Extracted from
// SessionHost.applyEngineState so the live host and the offline renderer use one
// path. `reloadDrumkit` is injected (live: fire-and-forget; offline: awaited).

import type { SessionLane } from '../session/session';
import type { NoteFxState } from '../notefx/notefx-types';
import type { KeymapEntry } from '../samples/types';

export interface ApplyLaneEngineStateDeps {
  loadNoteFx: (laneId: string, state: NoteFxState[] | undefined) => void;
  reloadDrumkit: (
    laneId: string,
    kitId: string,
    engine: { setKeymap(k: KeymapEntry[]): void },
  ) => void | Promise<void>;
}

type AnyEngine = {
  setKitMode?(m: 'synth' | 'sample'): void;
  setBaseValue(id: string, v: number): void;
  modulators?: { deserialize(s: unknown[]): void };
  setKeymap?(k: KeymapEntry[]): void;
  setPadStore?(s: Record<number, Record<string, number>>): void;
  setDrumVoiceMutes?(m: Record<string, boolean>): void;
};

export async function applyLaneEngineState(
  engine: AnyEngine,
  lane: SessionLane,
  _ctx: AudioContext,
  deps: ApplyLaneEngineStateDeps,
): Promise<void> {
  const es = lane.engineState;

  if (typeof engine.setKitMode === 'function') {
    engine.setKitMode(es?.kitMode ?? 'synth');
  }
  const params = es?.params;
  if (params) {
    for (const [id, v] of Object.entries(params)) {
      if (typeof v === 'number') engine.setBaseValue(id, v);
    }
  }
  const mods = es?.modulators;
  if (mods && engine.modulators) engine.modulators.deserialize(mods);

  deps.loadNoteFx(lane.id, es?.noteFx);

  const km = es?.sampler?.keymap;
  if (km && typeof engine.setKeymap === 'function') engine.setKeymap(km);

  const drumkitId = es?.sampler?.drumkitId;
  if (drumkitId && typeof engine.setKeymap === 'function') {
    // Only yield if the callback is actually async (offline render returns a
    // Promise so samples are decoded before setPadStore; the live host's
    // fire-and-forget returns undefined → keep the rest synchronous, preserving
    // the original ordering).
    const r = deps.reloadDrumkit(lane.id, drumkitId, engine as { setKeymap(k: KeymapEntry[]): void });
    if (r && typeof (r as Promise<void>).then === 'function') await r;
  }

  const padParams = es?.sampler?.padParams;
  if (padParams && typeof engine.setPadStore === 'function') engine.setPadStore(padParams);

  const drumMutes = es?.drumMutes;
  if (drumMutes && typeof engine.setDrumVoiceMutes === 'function') engine.setDrumVoiceMutes(drumMutes);
}
