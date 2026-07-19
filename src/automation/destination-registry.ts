// The single place anything asks "what can be automated right now".
//
// It wraps listAutomationTargets — which derives destinations from the session,
// never from the mounted-knob registry — and adds the change notification the
// four pickers need. Before this existed each picker built its own list from a
// different source, so adding an insert updated some of them and not others.
//
// DO NOT build a parallel list. If a new surface needs destinations, call
// list() here and subscribe() to stay fresh.

import { listAutomationTargets, type AutomationTarget } from './automation-targets';
import type { SessionState } from '../session/session';
import type { KnobHandle } from '../core/knob';

export interface DestinationRegistryDeps {
  getState(): SessionState;
  /** Live handles, consulted only for label + range of a mounted knob. */
  getKnobRegistry(): ReadonlyMap<string, KnobHandle>;
}

export interface DestinationRegistry {
  /** Every destination the session currently declares. */
  list(): AutomationTarget[];
  /** Subscribe to structural changes. Returns its own unsubscribe. */
  subscribe(fn: () => void): () => void;
  /** Announce that the set of destinations changed. */
  invalidate(): void;
}

export function createDestinationRegistry(deps: DestinationRegistryDeps): DestinationRegistry {
  const listeners = new Set<() => void>();
  return {
    list: () => listAutomationTargets(deps.getState(), deps.getKnobRegistry()),
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    invalidate() {
      // A throwing subscriber must not stop the others being told.
      for (const fn of [...listeners]) {
        try { fn(); } catch (err) { console.error('destination subscriber failed', err); }
      }
    },
  };
}
