// src/modulation/modulation-ui.ts
// Renders the modulators panel inside an engine's buildParamUI. Each engine
// instance has one ModulationHost; this UI mutates host state directly, then
// calls onLiveEdit (to make the edit audible) and/or onChange (when the engine
// must respawn modulator voices).
//
// The panel is a lit-html template rendered into a host element it owns, so a
// repaint patches what changed instead of rebuilding. That matters most for the
// DestinationRegistry subscription below: a structural change anywhere in the
// session — an insert added or removed on any lane — used to rebuild this whole
// panel, destroying every knob in it. Now it repaints the dropdown and leaves
// the knobs alone.

import { html, render, type TemplateResult } from 'lit-html';
import type { ModulatorState } from './types';
import { ControlCache } from './control-cache';
import { lfoConfigTemplate, adsrConfigTemplate } from './mod-config-templates';
import { routingTemplate } from './mod-routing-templates';
import { type PanelCtx, type ModulationUIDeps, sync, edit } from './mod-ui-shared';

export type { PanelCtx, ModulationUIDeps } from './mod-ui-shared';

const HOST_CLASS = 'mod-panel-host';

/** The render host and its cache, per container.
 *
 *  Weak-keyed on the container so a discarded container takes both with it.
 *  The cache is rebuilt whenever `deps` changes identity: the cached widgets
 *  close over `deps` permanently, so a new `deps` must mean new widgets, or a
 *  knob would keep firing the previous call's onLiveEdit/onChange. Rows also
 *  close over `mod` while being keyed by `mod.id`, so a same-id/different-object
 *  swap is invisible to both the key and this check — harmless only because such
 *  a swap always arrives with a fresh `deps` too. */
interface PanelState {
  host: HTMLElement;
  cache: ControlCache;
  deps: ModulationUIDeps;
  /** Drops the registry subscription this container currently holds. */
  unsubscribe?: () => void;
}
const panels = new WeakMap<HTMLElement, PanelState>();

export function renderModulatorsPanel(container: HTMLElement, deps: ModulationUIDeps): void {
  let state = panels.get(container);

  // A caller may have wiped the container between calls (many sites in this
  // codebase do `container.innerHTML = ''` before a rebuild), which detaches
  // the host without telling us. Re-adopt it if it is still there, rebuild it
  // if it is not — the cache goes with it, since its widgets are detached too.
  if (state && !container.contains(state.host)) {
    state.host = makeHost(container);
    state.cache = new ControlCache();
  }
  if (!state) {
    state = { host: makeHost(container), cache: new ControlCache(), deps };
    panels.set(container, state);
  }
  if (state.deps !== deps) {
    state.cache = new ControlCache();
    state.deps = deps;
  }

  const live = state;
  const ctx: PanelCtx = {
    deps,
    cache: live.cache,
    rerender: () => paint(live, ctx),
  };
  paint(live, ctx);

  // Exactly one subscription per container. Dropping the previous one first is
  // what stops them stacking: a rebuild — the caller's, or one this
  // subscription triggered — must not leave two listeners behind, or a single
  // registry change fans out into N repaints.
  live.unsubscribe?.();
  live.unsubscribe = deps.destinations?.subscribe(ctx.rerender);
}

function makeHost(container: HTMLElement): HTMLElement {
  const host = document.createElement('div');
  host.className = HOST_CLASS;
  container.appendChild(host);
  return host;
}

function paint(state: PanelState, ctx: PanelCtx): void {
  // Deliberately NOT wrapped in try/finally: control-cache.ts documents that a
  // render throwing partway must SKIP endPass(), so nothing is dropped while
  // still mounted. A `finally` here would delete live widgets. Don't "tidy" it
  // back in.
  state.cache.beginPass();
  render(panelTemplate(ctx), state.host);
  // TODO: endPass()'s dropped ids are discarded. They stay in deps.registry —
  // the app's one shared automation registry, built once in
  // automation-recording.ts, not a per-panel map — so a removed connection's
  // knob id lingers for the session. Bounded: the dropdown reads the
  // DestinationRegistry, so a phantom can never be offered as a target.
  // Resolve when `deps` grows an unregister API.
  state.cache.endPass();
}

function panelTemplate(ctx: PanelCtx): TemplateResult {
  const { deps } = ctx;
  const add = (kind: 'lfo' | 'adsr') => () => edit(deps, () => {
    deps.host.addModulator(kind);
    sync(deps);
    deps.onChange();
  });

  return html`
    <div class="mod-panel">
      <div class="mod-panel-title">MODULATORS</div>
      <div class="mod-panel-header">
        <button class="rnd" @click=${add('lfo')}>+ LFO</button>
        <button class="rnd" @click=${add('adsr')}>+ ADSR</button>
      </div>
      ${deps.host.modulators.map((mod) => modCardTemplate(mod, ctx))}
    </div>
  `;
}

function modCardTemplate(mod: ModulatorState, ctx: PanelCtx): TemplateResult {
  const { deps } = ctx;
  return html`
    <div class="mod-card mod-${mod.kind}">
      <div class="mod-card-row">
        <div class="mod-card-title">${mod.id.toUpperCase()}</div>
        ${mod.kind === 'lfo' ? lfoConfigTemplate(mod, ctx) : adsrConfigTemplate(mod, ctx)}
        <button
          class=${mod.enabled ? 'rnd primary' : 'rnd'}
          @click=${() => {
            edit(deps, () => { mod.enabled = !mod.enabled; sync(deps); });
            ctx.rerender();
          }}
        >${mod.enabled ? 'ON' : 'OFF'}</button>
        <button class="rnd" @click=${() => edit(deps, () => {
          deps.host.removeModulator(mod.id);
          sync(deps);
          deps.onChange();
        })}>×</button>
      </div>
      ${routingTemplate(mod, ctx)}
    </div>
  `;
}
