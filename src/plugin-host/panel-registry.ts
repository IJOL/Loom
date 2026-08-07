// A panel plugin owns a top-level view instead of a lane.
//
// The other three component kinds each have a fixed home — an engine goes in a
// lane, a modulator in the modulation panel, an fx in a rack — so the host
// never had to ask where to put one. A panel has no such home, and this
// registry is the one place that knows which panels exist, so the view tabs can
// be built from data rather than from a hand-written list.

import type { EngineParamSpec, PanelContext } from '@loom/plugin-sdk';

/** What a panel does with the zone it is given: fill it, and hand back its own
 *  teardown. The host never inspects what went inside.
 *
 *  Everything the panel needs to read or change arrives in `ctx`, because its
 *  code is compiled separately and cannot import ours. */
export type PanelMount = (host: HTMLElement, ctx: PanelContext) => () => void;

export interface PanelEntry {
  id: string;
  name: string;
  placement: 'main-view';
  /** Declared params — the panel's MUSICAL surface, automatable like any
   *  other. Its bespoke widgets are not here: those it asks for at runtime
   *  through `Loom.controls` and arranges inside its own zone. */
  params: EngineParamSpec[];
  /** Delivered from the plugin's main.js, the same way an fx delivers its
   *  factory. Absent until then — a manifest can declare a panel, but only
   *  running code can say how to draw it. */
  mount?: PanelMount;
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

/** The second half of a panel's arrival: the manifest declared it, main.js says
 *  how to draw it. Refusing an unknown id is the point — a plugin that mounts a
 *  panel it never declared would appear on screen having passed no validation
 *  at all. */
export function registerPanelMount(id: string, mount: PanelMount): void {
  const entry = panels.get(id);
  if (!entry) {
    throw new Error(`registerPanel("${id}"): this plugin's manifest never declared a panel component with that id`);
  }
  if (entry.mount) {
    throw new Error(`registerPanel("${id}"): a mount is already registered — registerPanel must be called at most once per id`);
  }
  entry.mount = mount;
}

export function listPanels(): PanelEntry[] {
  return [...panels.values()];
}

/** Test-only: the registry is module state, and tests must not leak into
 *  each other through it. */
export function clearPanels(): void {
  panels.clear();
}
