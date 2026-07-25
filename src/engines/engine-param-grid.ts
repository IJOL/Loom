// src/engines/engine-param-grid.ts
// Builds an engine's param controls into a container, grouped into one labelled
// row per distinct EngineParamSpec.group (first-appearance order). Ungrouped
// params render first in a plain knob-row. Continuous → knob; discrete → knob
// (formatted label) unless the spec opts into selectStyle: 'dropdown' → select.
// Extracted from worklet-lane-engine.buildParamUI so the grouped layout is
// unit-testable without a worklet and the engine file stays lean.
// Every value write goes through commitParam (engine-param-commit.ts) so the
// edit reaches BOTH the engine and lane.engineState.params — the grid used to
// call setBaseValue directly, which is why an fm/wavetable/karplus/westcoast/
// tb303 knob was thrown away on save.

import { html, render, nothing } from 'lit-html';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import type { EngineParamSpec } from './engine-params';
import type { EngineUIContext } from './engine-types';
import { attachKnobUndo } from '../save/history-wiring';
import { commitParam } from './engine-param-commit';

interface GridEngine {
  id: string;
  params: EngineParamSpec[];
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
}

export interface BuildGridOpts {
  /** If it returns true for a spec id, that spec is omitted. */
  skip?: (id: string) => boolean;
}

function buildControl(engine: GridEngine, ctx: EngineUIContext, spec: EngineParamSpec): HTMLElement {
  const registryId = `${ctx.laneId}.${spec.id}`;
  const discrete = spec.kind === 'discrete' && !!spec.options && spec.options.length > 0;

  // Only a discrete param explicitly opting into 'dropdown' renders as a
  // <select> (e.g. FM's Algorithm). Every other discrete param renders as a
  // knob, matching main's worklet grid — this keeps wavetable/westcoast/
  // karplus/tb303's osc/wave/env selectors visually unchanged.
  if (discrete && spec.selectStyle === 'dropdown') {
    const options = spec.options!;
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(engine.getBaseValue(spec.id))));
    const { el, handle } = createSelectControl({
      id: registryId,
      label: spec.label,
      options,
      initialValue: options[idx]?.value ?? options[0].value,
      forceSelect: true,
      showLabel: spec.showLabel,
      onChange: (v) => {
        const i = options.findIndex((o) => o.value === v);
        commitParam(engine, ctx, spec.id, Math.max(0, i));
      },
    });
    ctx.registerKnob(handle);
    return el;
  }

  const knob = createKnob({
    id: registryId,
    label: spec.label,
    min: spec.min,
    max: spec.max,
    step: discrete ? 1 : (spec.max - spec.min) / 200,
    value: engine.getBaseValue(spec.id),
    defaultValue: spec.default,
    color: spec.color,
    format: discrete
      ? (v) => spec.options![Math.max(0, Math.min(spec.options!.length - 1, Math.round(v)))].label
      : (spec.unit ? (v) => `${v.toFixed(2)}${spec.unit}` : undefined),
    onChange: (v) => { commitParam(engine, ctx, spec.id, v); },
    ...(ctx.historyDeps ? attachKnobUndo(ctx.historyDeps) : {}),
  });
  ctx.registerKnob(knob);
  return knob.el;
}

export function buildEngineParamGrid(
  engine: GridEngine,
  ctx: EngineUIContext,
  container: HTMLElement,
  opts: BuildGridOpts = {},
): void {
  const skip = opts.skip ?? (() => false);
  const order: string[] = [];
  const byGroup = new Map<string | undefined, EngineParamSpec[]>();
  for (const spec of engine.params) {
    if (skip(spec.id)) continue;
    const g = spec.group;
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      if (g !== undefined) order.push(g);
    }
    byGroup.get(g)!.push(spec);
  }

  // The grid is a one-shot build (the caller rebuilds the whole param UI on
  // engine swap), so the rows render once into a fragment — no panel lifecycle
  // needed — and the fragment is appended after the caller's existing children
  // (e.g. the POLY header). Controls stay imperative widgets; the templates
  // only interpolate their elements. Leading ungrouped row (global controls,
  // unlabelled) first, then one labelled section per group.
  const globals = byGroup.get(undefined);
  const frag = document.createDocumentFragment();
  render(html`
    ${globals && globals.length
      ? html`<div class="row knob-row">${globals.map((spec) => buildControl(engine, ctx, spec))}</div>`
      : nothing}
    ${order.map((g) => html`
      <div class="row poly-section">
        <div class="section-label">${g}</div>
        <div class="knob-row">${byGroup.get(g)!.map((spec) => buildControl(engine, ctx, spec))}</div>
      </div>`)}
  `, frag);
  container.appendChild(frag);
}
