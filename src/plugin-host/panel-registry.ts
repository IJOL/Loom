// A panel plugin owns a top-level view instead of a lane.
//
// The other three component kinds each have a fixed home — an engine goes in a
// lane, a modulator in the modulation panel, an fx in a rack — so the host
// never had to ask where to put one. A panel has no such home, and this
// registry is the one place that knows which panels exist, so the view tabs can
// be built from data rather than from a hand-written list.

import type { EngineParamSpec } from '@loom/plugin-sdk';

export interface PanelEntry {
  id: string;
  name: string;
  placement: 'main-view';
  /** Declared params, so a panel's controls can be automated like any other. */
  params: EngineParamSpec[];
}

const panels = new Map<string, PanelEntry>();

export function registerPanel(entry: PanelEntry): void {
  if (panels.has(entry.id)) {
    // First registration wins. A duplicate id is a packaging mistake, and
    // silently swapping the panel would turn it into a mystery.
    console.warn(`panel "${entry.id}" is already registered; keeping the first`);
    return;
  }
  panels.set(entry.id, entry);
}

export function unregisterPanel(id: string): void {
  panels.delete(id);
}

export function listPanels(): PanelEntry[] {
  return [...panels.values()];
}

/** Test-only: the registry is module state, and tests must not leak into
 *  each other through it. */
export function clearPanels(): void {
  panels.clear();
}
