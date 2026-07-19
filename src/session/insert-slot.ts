// src/session/insert-slot.ts
import type { FxInstance } from '../plugins/types';
import type { ModulatorState } from '../modulation/types';
import { createInstance } from '../plugins/registry';
import type { InsertChain } from '../plugins/fx/insert-chain';

export interface InsertSlot {
  /** Stable identity, independent of position in the chain. Minted on
   *  creation and backfilled at load for sessions saved before it existed.
   *  Position must never be used as identity: removing a slot renumbers
   *  every later one, which silently repoints anything addressing them. */
  id: string;
  pluginId: string;
  params: Record<string, number>;
  presetName?: string;
  modulators?: ModulatorState[];
  bypass: boolean;
}

let insertIdCounter = 0;

/** Mint a fresh slot id. Counter + random so ids stay unique across a reload
 *  where the counter restarts but old ids are already in the session. */
export function newInsertId(): string {
  insertIdCounter += 1;
  return `i${insertIdCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Give an id to any slot saved before ids existed. Idempotent. */
export function backfillInsertIds(slots: InsertSlot[] | undefined): void {
  for (const slot of slots ?? []) {
    if (!slot.id) slot.id = newInsertId();
  }
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
    chain.insert(inst, slot.id);
    if (slot.bypass) chain.setBypass(chain.size() - 1, true);
  }
}
