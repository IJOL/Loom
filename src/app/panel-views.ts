// Panel plugins as top-level views, alongside Session and Performance.
//
// The two built-in modes are hard-coded in index.html because they have always
// existed. A panel plugin cannot be: the host does not know which panels exist
// until the plugins have loaded. So its button and its root are built from
// listPanels(), which means the NEXT panel plugin needs no host change at all
// — the only way to know the fourth component kind actually works.

import { listPanels, type PanelEntry } from '../plugin-host/panel-registry';
import type { PanelContext } from '@loom/plugin-sdk';

export interface PanelViewHandle {
  /** Every registered panel's mode id, in registration order. */
  ids: string[];
  /** Show one panel's root and hide the rest. Pass a non-panel mode (session,
   *  performance) to hide them all. */
  show(mode: string): void;
  /** Tear every mounted panel down. */
  dispose(): void;
}

const ROOT_ID = 'panel-view-roots';
const rootIdFor = (id: string) => `panel-view-${id}`;

/** Build a button + root for each registered panel and mount it.
 *
 *  Mounting happens once, here, rather than on every switch: a panel holds live
 *  state (a weave in progress) and remounting it on each visit would throw that
 *  away — which is the same reason the Session view is hidden rather than
 *  rebuilt. */
export function wirePanelViews(
  onSelect: (mode: string) => void,
  makeContext: (refresh: () => void) => PanelContext,
): PanelViewHandle {
  const anchor = document.getElementById(ROOT_ID);
  const toggle = document.getElementById('mode-toggle');
  const panels: PanelEntry[] = listPanels();
  const teardowns: Array<() => void> = [];
  // Per panel, the closure that tears it down and builds it again. Kept so
  // `show` can refresh the one being entered: a panel reads the session when it
  // renders, and a lane added while it was hidden would otherwise be invisible
  // until the app restarted.
  const remounts = new Map<string, () => void>();

  for (const p of panels) {
    if (toggle) {
      const btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.dataset.mode = p.id;
      btn.textContent = p.name;
      btn.addEventListener('click', () => onSelect(p.id));
      toggle.appendChild(btn);
    }

    if (!anchor) continue;
    const root = document.createElement('div');
    root.id = rootIdFor(p.id);
    root.hidden = true;
    anchor.appendChild(root);

    // A panel whose plugin declared it but never delivered a mount is a broken
    // plugin, not a crash: the tab exists and says so rather than throwing at
    // boot and taking the whole app with it.
    if (!p.mount) {
      root.textContent = `${p.name} declared a panel but shipped no interface.`;
      continue;
    }
    try {
      // `refresh` remounts this panel and nothing else: a panel asking to
      // redraw must not tear down its neighbours.
      const mount = p.mount;
      let live: (() => void) | undefined;
      const remount = () => {
        try { live?.(); } catch { /* a panel that cannot tear down must still redraw */ }
        root.replaceChildren();
        live = mount(root, makeContext(remount));
      };
      remount();
      remounts.set(p.id, remount);
      teardowns.push(() => live?.());
    } catch (err) {
      console.error(`panel "${p.id}" failed to mount`, err);
      root.textContent = `${p.name} failed to load.`;
    }
  }

  return {
    ids: panels.map((p) => p.id),
    show(mode) {
      for (const p of panels) {
        const root = document.getElementById(rootIdFor(p.id));
        if (root) root.hidden = mode !== p.id;
      }
      // Refresh the one being entered, and only that one. A panel renders from
      // the session as it stands, so anything that changed while it was hidden
      // — a lane added, an engine swapped — has to be picked up here or it
      // stays invisible until the app restarts.
      remounts.get(mode)?.();
    },
    dispose() {
      while (teardowns.length) {
        try { teardowns.pop()!(); } catch { /* a panel that cannot tear down must not block the rest */ }
      }
    },
  };
}
