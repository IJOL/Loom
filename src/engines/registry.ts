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
  presets: EnginePreset[];
  /** The engine's DEFAULT modulator set (serialized state), used to seed a
   *  worklet lane's ModulationHost. */
  modulators: ModulatorState[];
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
    presets: eng.presets,
    modulators: eng.modulators.serialize(),
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
