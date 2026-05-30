// src/session/insert-slot.ts
import type { FxInstance } from '../plugins/types';
import type { ModulatorState } from '../modulation/types';
import { createInstance } from '../plugins/registry';
import type { InsertChain } from '../plugins/fx/insert-chain';

export interface InsertSlot {
  pluginId: string;
  params: Record<string, number>;
  presetName?: string;
  modulators?: ModulatorState[];
  bypass: boolean;
}

export function applyInsertSlot(slot: InsertSlot, inst: FxInstance): void {
  for (const [id, v] of Object.entries(slot.params)) inst.setBaseValue(id, v);
}

export function snapshotInsertSlot(slot: InsertSlot, inst: FxInstance, paramIds: string[]): InsertSlot {
  const params: Record<string, number> = {};
  for (const id of paramIds) params[id] = inst.getBaseValue(id);
  return { ...slot, params };
}

/** Rehydrate a list of InsertSlots into an InsertChain.
 *  Slots that reference an unknown plugin id are silently skipped. */
export function rehydrateInsertChain(
  ctx: AudioContext, chain: InsertChain, slots: InsertSlot[],
): void {
  for (const slot of slots) {
    const inst = createInstance('fx', slot.pluginId, ctx);
    if (!inst) continue;
    applyInsertSlot(slot, inst);
    chain.insert(inst);
    if (slot.bypass) chain.setBypass(chain.size() - 1, true);
  }
}
