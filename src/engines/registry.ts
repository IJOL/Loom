// src/engines/registry.ts
//
// Engines support two access patterns:
//
//   1. Singleton (legacy): registerEngine(engineInstance), getEngine(id)
//      Used by the main poly today — one shared instance per engine type.
//
//   2. Factory (new): registerEngineFactory(id, () => new XEngine()),
//      createEngineInstance(id)
//      Used by per-lane engines where each lane needs its own state.
//
// Both can coexist. listEngines() reads from the singleton map for now (it's
// the source of metadata: name, type, polyphony, params).

import type { SynthEngine } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { EnginePreset } from './engine-types';
import type { ModulatorState } from '../modulation/types';
import type { EngineParamGroup } from './engine-param-groups';

const engines = new Map<string, SynthEngine>();
const factories = new Map<string, () => SynthEngine>();

/** Pure-data view of an engine's metadata — id/name/polyphony/editor/params/
 *  presets/default modulators — with NO live AudioNodes. The worklet lane
 *  allocator reads this to build a WorkletLaneEngine without constructing a
 *  legacy node-per-note engine just to copy its spec, and the engine selector
 *  UI reads it for labels/editor filtering. */
export interface EngineDescriptor {
  id: string;
  name: string;
  polyphony: 'mono' | 'poly';
  editor: 'piano-roll' | 'drum-grid';
  params: EngineParamSpec[];
  /** Declared editor layout for `params` (see SynthEngine.groups). Must reach
   *  the live engine the allocator builds — omitting it here or in
   *  lane-allocator.ts's WorkletEngineConfig means the editor silently falls
   *  back to the pre-groups rendering (one row per group, first-appearance
   *  order) even though the engine declared a table. */
  groups?: EngineParamGroup[];
  presets: EnginePreset[];
  /** The engine's DEFAULT modulator set (serialized state), used to seed a
   *  worklet lane's ModulationHost. */
  modulators: ModulatorState[];
  /** Params this engine declares only once it can see the lane — LAYERS, whose
   *  four slots each contribute their own engine's knobs. Read where the lane's
   *  live engine is CONSTRUCTED, because the worklet numbers a lane's params
   *  once and keeps that numbering for the lane's lifetime.
   *
   *  It was already on SynthEngine and on the descriptor factory; not carrying
   *  it here meant the allocator, the one caller that has to fold these in
   *  before the numbering is fixed, could not see them. */
  dynamicParamsFor?(lane: import('../session/session').SessionLane): EngineParamSpec[];
  /** Lane state this engine's renderer needs that is NOT a number, ready to post
   *  to the worklet. Absent — which is every engine but LAYERS — means there is
   *  none, and the allocator posts nothing.
   *
   *  Declared rather than switched on an id: the allocator must not grow a
   *  branch per engine, and the next engine that needs some would add one. */
  structuralFor?(lane: import('../session/session').SessionLane): unknown;
  /** A control this engine needs that a knob grid cannot express, drawn above
   *  its grid. LAYERS has one — which instrument is in each slot is a dropdown,
   *  not a number. Absent for every other engine. */
  extraUI?: (
    host: HTMLElement, ctx: import('./engine-types').EngineUIContext, engine: SynthEngine,
  ) => void;
  /** Section titles this engine only knows once it can see the lane — LAYERS,
   *  whose open tab renders its instrument's REAL layout rather than one flat
   *  row. Same reason as dynamicParamsFor, and read at the same moment. */
  dynamicGroupsFor?(lane: import('../session/session').SessionLane): EngineParamGroup[];
  /** A param this engine declares but does not want DRAWN right now. See
   *  WorkletEngineConfig.hideParam. */
  hideParam?: (laneId: string, paramId: string) => boolean;
  /** Modulation targets this engine has that are NOT declared params.
   *
   *  Every engine already gets three of these for free — `amp`, `filter.env`,
   *  `amp.gain` — because a per-voice envelope is not a knob. LAYERS needs one
   *  set PER SLOT: four instruments in one lane sharing a single amplitude
   *  envelope is four instruments that cannot have different envelopes.
   *
   *  Static, not per-lane, and read at the same moment as the params: the
   *  worklet numbers a lane once and keeps that numbering for its lifetime. */
  modTargets?: readonly string[];
}

export function registerEngine(engine: SynthEngine): void {
  if (engines.has(engine.id)) {
    console.warn(`Engine "${engine.id}" already registered, overwriting.`);
  }
  engines.set(engine.id, engine);
}

export function registerEngineFactory(id: string, factory: () => SynthEngine): void {
  if (factories.has(id)) {
    console.warn(`Engine factory "${id}" already registered, overwriting.`);
  }
  factories.set(id, factory);
}

/** Reverses registerEngine + registerEngineFactory for one id. The rollback
 *  half of a plugin component's registration — used when a plugin's own
 *  main.js throws AFTER its engine was already adopted, so the failure does
 *  not leave a half-registered engine (visible in the selector, silent at
 *  note time) behind. See plugin-host.ts. */
export function unregisterEngine(id: string): void {
  engines.delete(id);
  factories.delete(id);
}

export function getEngine(id: string): SynthEngine | undefined {
  return engines.get(id);
}

// Create a fresh, independent engine instance with its own state. Falls back
// to the singleton if no factory is registered (so legacy engines still work).
export function createEngineInstance(id: string): SynthEngine | undefined {
  const f = factories.get(id);
  if (f) return f();
  return engines.get(id);
}

export function listEngines(type?: 'polyhost' | 'tab'): SynthEngine[] {
  const all = Array.from(engines.values());
  return type ? all.filter((e) => e.type === type) : all;
}

/** Engine metadata WITHOUT constructing a new engine instance. Derived from the
 *  registered singleton (built once at module load), so calling this never runs
 *  a legacy engine constructor — the worklet allocator uses it to build a
 *  WorkletLaneEngine without instantiating a node-per-note legacy class.
 *  Returns undefined for unknown ids. */
export function getEngineDescriptor(id: string): EngineDescriptor | undefined {
  const eng = engines.get(id);
  if (!eng) return undefined;
  return {
    id: eng.id,
    name: eng.name,
    polyphony: eng.polyphony,
    editor: eng.editor,
    params: eng.params,
    groups: eng.groups,
    presets: eng.presets,
    modulators: eng.modulators.serialize(),
    // Bound so it keeps the engine as its receiver. Left off, LAYERS lanes
    // allocate with the rack's params missing from the numbering and every
    // layer knob is silently unaddressable.
    dynamicParamsFor: eng.dynamicParamsFor?.bind(eng),
    structuralFor: eng.structuralFor?.bind(eng),
    extraUI: eng.extraUI,
    dynamicGroupsFor: eng.dynamicGroupsFor?.bind(eng),
    hideParam: eng.hideParam,
    modTargets: eng.modTargets,
  };
}

/** Returns the set of automatable paramIds the engine exposes. Used by the
 *  clip-ops layer to decide which envelopes on a moved/copied clip remain
 *  enabled after crossing into a different engine. Unknown engineIds yield
 *  an empty set. */
export function getEngineParamIds(engineId: string): ReadonlySet<string> {
  const eng = getEngine(engineId);
  if (!eng) return new Set();
  return new Set(eng.params.map((p) => p.id));
}
