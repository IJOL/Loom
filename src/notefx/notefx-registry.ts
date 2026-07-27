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

/** Drop every lane's chain. The registry is keyed by lane id and only ever
 *  grew, so a chain outlived the lane that owned it — `resetAllResources`
 *  (New / any session load) calls this so note-FX don't ride into the next
 *  session. Also the reset seam tests use between cases. */
export function clearNoteFxChains(): void { chains.clear(); }
