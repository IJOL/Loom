// src/session/insert-slot.ts
import type { FxInstance } from '../plugins/types';
import type { ModulatorState } from '../modulation/types';
import { createInstance } from '../plugins/registry';
import { createMissingFx } from '../core/missing-fx';
import type { InsertChain } from '../core/insert-chain';

export interface InsertSlot {
  /** Stable identity, independent of position in the chain. Minted on
   *  creation. Position must never be used as identity: removing a slot
   *  renumbers every later one, which silently repoints anything addressing
   *  them. */
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

export function applyInsertSlot(slot: InsertSlot, inst: FxInstance): void {
  for (const [id, v] of Object.entries(slot.params)) inst.setBaseValue(id, v);
}

export function snapshotInsertSlot(slot: InsertSlot, inst: FxInstance, paramIds: string[]): InsertSlot {
  const params: Record<string, number> = {};
  for (const id of paramIds) params[id] = inst.getBaseValue(id);
  return { ...slot, params };
}

/** Rehydrate a list of InsertSlots into an InsertChain.
 *  A slot whose plugin id is not registered becomes a marked pass-through
 *  (missing-fx.ts) rather than being skipped — the chain stays 1:1 with the
 *  slot list and the reference the session carries is never dropped. */
export function rehydrateInsertChain(
  ctx: AudioContext, chain: InsertChain, slots: InsertSlot[],
): void {
  for (const slot of slots) {
    // A slot whose plugin is not installed becomes a marked pass-through rather
    // than nothing. Skipping it desynchronised the chain from the slot list and
    // every later unit rendered its neighbour's data; and it silently dropped a
    // reference the session still carries.
    let inst = createInstance('fx', slot.pluginId, ctx);
    if (inst) {
      // A freshly created real instance starts at ITS OWN defaults (whatever
      // create(ctx) set), not the slot's saved values — apply the persisted
      // params onto it. This is the single source of truth for a real instance.
      applyInsertSlot(slot, inst);
    } else {
      // createMissingFx already seeds itself from slot.params — that is ITS
      // contract, tested directly in missing-fx.test.ts — so it is the single
      // source of truth for the placeholder. Calling applyInsertSlot here too
      // would just rewrite the same keys through setBaseValue a second time.
      inst = createMissingFx(ctx, slot.pluginId, slot.params);
    }
    chain.insert(inst, slot.id);
    if (slot.bypass) chain.setBypass(chain.size() - 1, true);
  }
}
