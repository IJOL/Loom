// src/modulation/generic-mod-config.ts
// The config row the host builds for a modulator component that declares
// `params` but brings no `configTemplate` of its own — the ONLY route a
// plugin modulator can take, since its compiled main.js cannot import our
// bundled lit-html (see modulator-registry.ts). One control per declared
// param, built through the same createKnob/createSelectControl + ControlCache
// machinery lfoConfigTemplate uses, so a generic modulator's knobs register
// and behave exactly like a hand-built one's.
//
// The bag is numeric end to end (design doc §4): a discrete param is stored
// as an OPTION INDEX, never the option's string value, matching
// getBaseValue(id): number — the signature automation, MIDI mapping, XY pads
// and the destination registry all sit on.

import { html, type TemplateResult } from 'lit-html';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import type { EngineParamSpec } from '../engines/engine-params';
import type { ModulatorState } from './types';
import type { ModulatorComponent } from './modulator-registry';
import { type PanelCtx, sync } from './mod-ui-shared';

function buildControl(mod: ModulatorState, ctx: PanelCtx, spec: EngineParamSpec): HTMLElement {
  const { deps, cache } = ctx;
  const id = `${deps.laneId}.mod.${mod.id}.${spec.id}`;
  // Reads/writes go through the bag exactly as the brief specifies: default
  // from the spec until the user (or a save) has set something, and every
  // write lands in `mod.params`, never in a named field — the bag is the
  // only place a component with no field of its own has to write.
  const current = (): number => mod.params?.[spec.id] ?? spec.default;
  const write = (v: number): void => {
    (mod.params ??= {})[spec.id] = v;
    sync(deps);   // push to the live engine — without this the worklet never hears it
  };

  if (spec.kind === 'discrete' && spec.options && spec.options.length > 0) {
    const options = spec.options;
    const clampIdx = (v: number) => Math.max(0, Math.min(options.length - 1, Math.round(v)));
    const { el } = cache.get(id, () => {
      const c = createSelectControl({
        id,
        label: spec.label,
        options,
        initialValue: options[clampIdx(current())]?.value ?? options[0].value,
        onChange: (v) => write(Math.max(0, options.findIndex((o) => o.value === v))),
      });
      deps.registerKnob(c.handle);
      return c;
    });
    return el;
  }

  const knob = cache.get(id, () => {
    const k = createKnob({
      id,
      label: spec.label,
      min: spec.min,
      max: spec.max,
      // Unquantised, like the flat engine-param-grid layout: a generic
      // modulator param isn't a fixed grid, so a drag/automation write should
      // land at the exact value, not snap to a synthetic step.
      value: current(),
      defaultValue: spec.default,
      color: spec.color,
      format: spec.unit ? (v) => `${v.toFixed(2)}${spec.unit}` : undefined,
      onChange: write,
    });
    deps.registerKnob(k);
    return k;
  });
  return knob.el;
}

/** The config row for a component that brings its own DOM builder
 *  (`configMount`) — a plugin's custom editor. Mounted once through the same
 *  ControlCache the knobs use, so the ELEMENT survives repaints; lit-html only
 *  re-slots the cached node. The api closes over `mod`, whose object identity
 *  the host keeps stable across renders. */
export function pluginConfigTemplate(
  comp: ModulatorComponent, mod: ModulatorState, ctx: PanelCtx,
): TemplateResult {
  const { deps, cache } = ctx;
  const id = `${deps.laneId}.mod.${mod.id}.__mount`;
  const { el } = cache.get(id, () => {
    const root = document.createElement('div');
    root.className = 'mod-card-config mod-plugin-config';
    comp.configMount!(root, {
      get: (key, def) => mod.params?.[key] ?? def,
      set: (key, v) => {
        (mod.params ??= {})[key] = v;
        sync(deps);   // push to the live engine — without this the worklet never hears it
      },
    });
    return { el: root };
  });
  return html`${el}`;
}

/** Built from `comp.params` — empty when the component declares none, which
 *  keeps a component with a hand-built `configTemplate` (LFO, ADSR) from ever
 *  reaching this path (see configRowFor in modulation-ui.ts). */
export function genericModConfigTemplate(
  comp: ModulatorComponent, mod: ModulatorState, ctx: PanelCtx,
): TemplateResult {
  const specs = comp.params ?? [];
  return html`
    <div class="mod-card-config mod-generic-config">
      ${specs.map((spec) => buildControl(mod, ctx, spec))}
    </div>
  `;
}
