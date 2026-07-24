// src/core/lit-panel.ts
// The one way to mount a lit-html panel inside a caller-owned container.
// Extracted from the modulators-panel pilot so every panel shares the same
// lifecycle instead of re-deriving it:
//
// - The panel renders into a dedicated host <div> it owns, so repainting the
//   panel never touches sibling content in the container.
// - Callers all over this codebase do `container.innerHTML = ''` before a
//   rebuild, which detaches the host without telling us. Each mount re-adopts
//   the container: if the host is gone, a fresh host (and cache — its widgets
//   were detached too) is built.
// - Cached widgets close over `deps` permanently, so a new `deps` identity must
//   mean new widgets; otherwise a knob would keep firing the previous call's
//   callbacks. The cache is dropped whenever `deps` changes identity.
//
// A container can hold several independent panels; the host className is the
// panel's identity within its container.

import { render, type TemplateResult } from 'lit-html';
import { ControlCache } from './control-cache';

export interface PanelHandle<D> {
  host: HTMLElement;
  cache: ControlCache;
  deps: D;
  /** Repaints the panel in place through lit-html's patching render. This is
   *  what replaces imperative refreshXxx() closures. */
  rerender: () => void;
  /** Stores a teardown hook (e.g. a registry unsubscribe) on the panel,
   *  running the previous one first. Exactly one hook per panel: a rebuild
   *  must not leave two subscriptions behind, or a single change fans out
   *  into N repaints. */
  setCleanup: (fn: (() => void) | undefined) => void;
}

interface PanelState {
  host: HTMLElement;
  cache: ControlCache;
  deps: unknown;
  cleanup?: () => void;
}

/** Weak-keyed on the container so a discarded container takes its panels,
 *  caches and cleanup closures with it. */
const panelsByContainer = new WeakMap<HTMLElement, Map<string, PanelState>>();

export function mountPanel<D>(opts: {
  container: HTMLElement;
  /** Class for the render host; also the panel's identity in the container. */
  className: string;
  deps: D;
  template: (handle: PanelHandle<D>) => TemplateResult;
}): PanelHandle<D> {
  const { container, className, deps } = opts;

  let byClass = panelsByContainer.get(container);
  if (!byClass) {
    byClass = new Map();
    panelsByContainer.set(container, byClass);
  }

  let state = byClass.get(className);
  if (state && !container.contains(state.host)) {
    state.host = makeHost(container, className);
    state.cache = new ControlCache();
  }
  if (!state) {
    state = { host: makeHost(container, className), cache: new ControlCache(), deps };
    byClass.set(className, state);
  }
  if (state.deps !== deps) {
    state.cache = new ControlCache();
    state.deps = deps;
  }

  const live = state;
  const handle: PanelHandle<D> = {
    host: live.host,
    cache: live.cache,
    deps,
    rerender: () => paint(live, handle, opts.template),
    setCleanup: (fn) => {
      live.cleanup?.();
      live.cleanup = fn;
    },
  };
  paint(live, handle, opts.template);
  return handle;
}

function makeHost(container: HTMLElement, className: string): HTMLElement {
  const host = document.createElement('div');
  host.className = className;
  container.appendChild(host);
  return host;
}

function paint<D>(
  state: PanelState,
  handle: PanelHandle<D>,
  template: (handle: PanelHandle<D>) => TemplateResult,
): void {
  // Deliberately NOT wrapped in try/finally: control-cache.ts documents that a
  // render throwing partway must SKIP endPass(), so nothing is dropped while
  // still mounted. A `finally` here would delete live widgets. Don't "tidy" it
  // back in.
  state.cache.beginPass();
  render(template(handle), state.host);
  state.cache.endPass();
}
