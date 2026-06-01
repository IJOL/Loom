// src/notefx/notefx-registry.ts
// Per-lane NoteFxChain instances, shared between the trigger path and the UI.
// Replaces the old global arp singleton with one chain per lane id.
import { NoteFxChain } from './notefx-chain';
import type { NoteFxState } from './notefx-types';

const chains = new Map<string, NoteFxChain>();

export function getNoteFxChain(laneId: string): NoteFxChain {
  let c = chains.get(laneId);
  if (!c) { c = new NoteFxChain([]); chains.set(laneId, c); }
  return c;
}

/** Replace a lane's chain contents from saved state. `undefined` clears it
 *  (passthrough). Called on demo/session load so note-FX follow the demo. */
export function loadNoteFxForLane(laneId: string, state: NoteFxState[] | undefined): void {
  getNoteFxChain(laneId).deserialize(state ?? []);
}

/** Test-only. */
export function _resetNoteFxRegistry(): void { chains.clear(); }
