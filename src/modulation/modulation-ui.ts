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

import { html, type TemplateResult } from 'lit-html';
import type { ModulatorState } from './types';
import { mountPanel } from '../core/lit-panel';
import { getModulator, listModulators } from './modulator-registry';
import { routingTemplate } from './mod-routing-templates';
import { type PanelCtx, type ModulationUIDeps, sync, edit } from './mod-ui-shared';

export type { PanelCtx, ModulationUIDeps } from './mod-ui-shared';

const HOST_CLASS = 'mod-panel-host';

// Host/cache lifecycle (re-adopt after a caller's innerHTML wipe, cache reset
// on a deps identity change) lives in core/lit-panel.ts — this panel was its
// pilot. One quirk stays local: rows close over `mod` while being keyed by
// `mod.id`, so a same-id/different-object swap is invisible to the cache —
// harmless only because such a swap always arrives with a fresh `deps` too.
//
// TODO: cache-dropped ids stay in deps.registry — the app's one shared
// automation registry, built once in automation-recording.ts, not a per-panel
// map — so a removed connection's knob id lingers for the session. Bounded:
// the dropdown reads the DestinationRegistry, so a phantom can never be
// offered as a target. Resolve when `deps` grows an unregister API.

export function renderModulatorsPanel(container: HTMLElement, deps: ModulationUIDeps): void {
  const handle = mountPanel({
    container,
    className: HOST_CLASS,
    deps,
    template: (h) => panelTemplate(h),
  });
  // Exactly one subscription per container — setCleanup drops the previous
  // one, which is what stops them stacking: a rebuild (the caller's, or one
  // this subscription triggered) must not leave two listeners behind, or a
  // single registry change fans out into N repaints.
  handle.setCleanup(deps.destinations?.subscribe(handle.rerender));
}

function panelTemplate(ctx: PanelCtx): TemplateResult {
  const { deps } = ctx;
  const add = (kind: string) => () => edit(deps, () => {
    deps.host.addModulator(kind);
    sync(deps);
    deps.onChange();
  });

  return html`
    <div class="mod-panel">
      <div class="mod-panel-title">MODULATORS</div>
      <div class="mod-panel-header">
        ${listModulators().map(
          (c) => html`<button class="rnd" @click=${add(c.id)}>+ ${c.name}</button>`,
        )}
      </div>
      ${deps.host.modulators.map((mod) => modCardTemplate(mod, ctx))}
    </div>
  `;
}

/** A component's own config row when it brings one; otherwise the panel the
 *  host builds from its declared params. A plugin can only take the second
 *  route — its compiled main.js cannot import our bundled lit-html. */
function configRowFor(mod: ModulatorState, ctx: PanelCtx): TemplateResult {
  const comp = getModulator(mod.kind);
  if (!comp) return html`<div class="mod-card-config">unknown modulator: ${mod.kind}</div>`;
  if (comp.configTemplate) return comp.configTemplate(mod, ctx);
  // TODO: Task 8 — replace with genericModConfigTemplate(comp, mod, ctx), the
  // host-built grid from the component's declared `params`. Every registered
  // component today (LFO, ADSR) has its own configTemplate, so this branch is
  // unreachable in production until a params-only component is registered.
  return html`<div class="mod-card-config"></div>`;
}

function modCardTemplate(mod: ModulatorState, ctx: PanelCtx): TemplateResult {
  const { deps } = ctx;
  return html`
    <div class="mod-card mod-${mod.kind}">
      <div class="mod-card-row">
        <div class="mod-card-title">${mod.id.toUpperCase()}</div>
        ${configRowFor(mod, ctx)}
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
