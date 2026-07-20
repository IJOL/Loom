// src/modulation/mod-routing-templates.ts
// The routing half of a modulator card: one row per existing connection, plus
// the "+ Destination" adder. Destinations come from the one shared
// DestinationRegistry; the panel subscribes to it, so this template recomputes
// on every structural change without the dropdown having to be reopened.

import { html, type TemplateResult } from 'lit-html';
import { createRef, ref } from 'lit-html/directives/ref.js';
import { createKnob } from '../core/knob';
import { attachKnobUndo } from '../save/history-wiring';
import { formatParamIdForDisplay } from '../core/lane-display';
import { groupTargetsByLane, type AutomationTarget } from '../automation/automation-targets';
import type { ModulatorState, ModulationConnection } from './types';
import { type PanelCtx, sync, edit } from './mod-ui-shared';

/** Every param this modulator could still target, grouped by lane name.
 *
 *  The per-lane binder (voice-mod-binding.ts's applyBinder) can only resolve
 *  THIS lane's engine params, THIS lane's insert chain, and the master chain —
 *  it never receives another lane's chain, and never a send rack. A destination
 *  outside that set would create a connection that looks identical to a working
 *  one and silently never binds to an AudioParam, so the filter is load-bearing,
 *  not cosmetic. */
function destinationGroups(mod: ModulatorState, ctx: PanelCtx): Map<string, AutomationTarget[]> {
  const { deps } = ctx;
  const used = new Set(mod.connections.map((c) => c.paramId));
  const reachable = (deps.destinations?.list() ?? [])
    .filter((t) => t.laneId === deps.laneId || t.laneId === 'fx.master')
    .filter((t) => !used.has(t.id));
  return groupTargetsByLane(reachable);
}

export function routingTemplate(mod: ModulatorState, ctx: PanelCtx): TemplateResult {
  const { deps } = ctx;
  const selRef = createRef<HTMLSelectElement>();

  const onAdd = () => {
    const paramId = selRef.value?.value;
    if (!paramId) return;
    edit(deps, () => {
      const cid = `c-${Date.now().toString(36)}`;
      deps.host.setConnection(mod.id, { id: cid, paramId, depth: 0.5 });
      sync(deps);
      deps.onChange();
    });
  };

  return html`
    <div class="mod-card-routing">
      ${mod.connections.map((conn) => connectionRowTemplate(mod, conn, ctx))}
      <div class="mod-conn-adder">
        <select
          class="mod-dest-select"
          ${ref(selRef)}
          @pointerdown=${ctx.rerender}
        >
          ${[...destinationGroups(mod, ctx)].map(([laneName, targets]) => html`
            <optgroup label=${laneName}>
              ${targets.map((t) => html`<option value=${t.id}>${t.label}</option>`)}
            </optgroup>
          `)}
        </select>
        <button class="rnd primary" @click=${onAdd}>+ Destination</button>
      </div>
    </div>
  `;
}

function connectionRowTemplate(
  mod: ModulatorState,
  conn: ModulationConnection,
  ctx: PanelCtx,
): TemplateResult {
  const { deps, cache } = ctx;
  const label = deps.lookupLaneDisplayName
    ? formatParamIdForDisplay(conn.paramId, deps.lookupLaneDisplayName)
    : conn.paramId;

  const depthId = `${deps.laneId}.mod.${mod.id}.conn.${conn.id}.depth`;
  const depth = cache.get(depthId, () => {
    const k = createKnob({
      id: depthId,
      label: 'DEPTH',
      min: -1, max: 1, step: 0.001,
      value: conn.depth,
      defaultValue: 0,
      onChange: (v) => {
        // Resolve the connection by id rather than closing over `conn`: this
        // knob is cached, so it outlives the render that built it, and
        // setConnection REPLACES the object inside mod.connections. A captured
        // `conn` would go stale after the first edit. The `!live` bail also
        // matters: a removed connection's knob stays in the shared automation
        // registry, so automation could still drive it — and without the guard
        // that would resurrect a routing the user deleted.
        const live = mod.connections.find((c) => c.id === conn.id);
        if (!live) return;
        deps.host.setConnection(mod.id, { ...live, depth: v });
        sync(deps);
      },
      format: (v) => v.toFixed(2),
      ...(deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {}),
    });
    deps.registerKnob(k);
    return k;
  });

  return html`
    <div class="mod-conn-row">
      <span class="mod-conn-target">${label}</span>
      ${depth.el}
      <button class="rnd" @click=${() => edit(deps, () => {
        deps.host.removeConnection(mod.id, conn.id);
        sync(deps);
        deps.onChange();
      })}>×</button>
    </div>
  `;
}
