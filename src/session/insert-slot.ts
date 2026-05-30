// src/session/insert-slot.ts
import type { FxInstance } from '../plugins/types';
import type { ModulatorState } from '../modulation/types';

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
