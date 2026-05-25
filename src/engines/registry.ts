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

const engines = new Map<string, SynthEngine>();
const factories = new Map<string, () => SynthEngine>();

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
