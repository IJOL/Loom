// The stand-in for an insert whose plugin is not installed here.
//
// It is a pass-through, but it is NOT a silence: it keeps the slot's id and its
// saved params, so the rack can draw a marked unit and a save re-writes the
// settings untouched. Uninstalling a plugin must never delete what the user set.
//
// The rule this obeys is the one the modulator slice wrote down: what is only
// USED can be removed; what is also REFERENCED from saved data cannot. An insert
// slot is referenced from saved data, so the reference survives as this.
import type { FxInstance } from '../plugins/types';

const warned = new Set<string>();
const MISSING = Symbol('loom.missingFx');

export function createMissingFx(
  ctx: AudioContext, pluginId: string, params: Record<string, number>,
): FxInstance {
  if (!warned.has(pluginId)) {
    warned.add(pluginId);
    // Once per id, not once per slot: a session with the same effect on eight
    // lanes should say one thing, not eight.
    console.warn(`[inserts] "${pluginId}" is not installed. Its slots keep their settings; install the plugin and reload.`);
  }
  const node = ctx.createGain();
  const values = { ...params };
  const inst = {
    input: node,
    output: node,
    getAudioParams: () => new Map<string, AudioParam>(),
    getBaseValue: (id: string) => values[id] ?? 0,
    setBaseValue: (id: string, v: number) => { values[id] = v; },
    applyPreset: () => {},
    dispose: () => { try { node.disconnect(); } catch { /* ok */ } },
  } as FxInstance;
  (inst as unknown as Record<symbol, boolean>)[MISSING] = true;
  return inst;
}

export function isMissingFx(fx: FxInstance): boolean {
  return (fx as unknown as Record<symbol, boolean>)[MISSING] === true;
}

/** Test-only. */
export function __resetMissingFxWarnings(): void { warned.clear(); }
