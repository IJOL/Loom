// @vitest-environment jsdom
//
// A panel renders from the session as it stands, and the session can be
// REPLACED under it: New, a save, a demo. Entering a panel already remounted it
// — the panel you were looking at when the swap happened did not.
//
// What that looked like: load a demo while the WEAVE panel is on screen and it
// goes on listing the previous session's lanes, with their old topologies, over
// a session that has never heard of them. Every control on it then writes to a
// lane id that no longer exists.
import { describe, it, expect, beforeEach } from 'vitest';
import { wirePanelViews } from './panel-views';
import {
  registerPanel, registerPanelMount, clearPanels,
} from '../plugin-host/panel-registry';
import type { PanelContext } from '@loom/plugin-sdk';

/** A panel that counts how many times it has been built. */
function countingPanel(id: string) {
  const mounts: number[] = [];
  registerPanel({ id, name: id, placement: 'main-view', params: [] });
  registerPanelMount(id, (root) => {
    mounts.push(1);
    root.textContent = `${id} #${mounts.length}`;
    return () => {};
  });
  return { get count() { return mounts.length; } };
}

function dom() {
  document.body.innerHTML = '<div id="mode-toggle"></div><div id="panel-view-roots"></div>';
}

const ctx = () => ({} as unknown as PanelContext);

describe('wirePanelViews', () => {
  beforeEach(() => { clearPanels(); dom(); });

  it('rebuilds the panel on screen when the session is replaced', () => {
    const panel = countingPanel('weave');
    const views = wirePanelViews(() => {}, ctx);
    views.show('weave');
    const afterShow = panel.count;

    views.refreshVisible();
    expect(panel.count).toBe(afterShow + 1);
  });

  it('leaves a hidden panel alone — entering it already rebuilds it', () => {
    // Rebuilding every panel on every session change would throw away live
    // state in panels nobody is looking at, for a redraw `show` does anyway.
    const panel = countingPanel('weave');
    const views = wirePanelViews(() => {}, ctx);
    views.show('session');                 // a non-panel mode: everything hidden
    const afterShow = panel.count;

    views.refreshVisible();
    expect(panel.count).toBe(afterShow);
  });

  it('does nothing before any view has been shown', () => {
    const panel = countingPanel('weave');
    const views = wirePanelViews(() => {}, ctx);
    const afterMount = panel.count;
    views.refreshVisible();
    expect(panel.count).toBe(afterMount);
  });
});
