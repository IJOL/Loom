// src/engines/engine-param-grid.ts
// THE builder that turns an engine's EngineParamSpec[] into UI controls: one
// knob or select per spec, registered under the canonical `<laneId>.<spec.id>`
// so modulation/automation pickers can address it, with undo attached.
//
// Two layouts, both approved and both still shipping:
//   'grouped' (default) — one labelled row per spec.group, quantised drag, and
//     discrete → knob unless selectStyle 'dropdown'. The worklet lane pages.
//   'flat' — controls appended straight into the caller's own row, unquantised,
//     and discrete → select control. The drum rack, the sampler pads, the
//     audio-clip toolbar, the subtractive page. This layout used to be a SECOND
//     copy of the whole walk (the deleted engine-ui.wireEngineParams), which is
//     how the two drifted apart on units, step and index clamping.
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
  /** Knob SVG size in px (continuous params only). Default: createKnob's own. */
  knobSize?: number;
  /** Value-readout formatter keyed by spec id. Wins over `spec.unit`. */
  formatter?: (specId: string, v: number) => string;
  /**
   * 'grouped' (default): one labelled row per `spec.group`, quantised drags,
   * and a discrete param renders as a KNOB unless it opts into
   * `selectStyle: 'dropdown'` — the approved worklet-lane look.
   * 'flat': controls are appended straight into the caller's own row, in
   * declaration order, unquantised, and EVERY discrete param renders as a
   * select control. That is the approved look of the drum rack, the sampler
   * pads, the audio-clip toolbar and the subtractive page, which used to get
   * it from a second spec-walking builder.
   */
  layout?: 'grouped' | 'flat';
}

function buildControl(
  engine: GridEngine, ctx: EngineUIContext, spec: EngineParamSpec, opts: BuildGridOpts,
): HTMLElement {
  const registryId = `${ctx.laneId}.${spec.id}`;
  const flat = opts.layout === 'flat';
  const discrete = spec.kind === 'discrete' && !!spec.options && spec.options.length > 0;

  // Grouped: only a discrete param explicitly opting into 'dropdown' renders as
  // a <select> (e.g. FM's Algorithm); every other discrete param renders as a
  // knob, keeping wavetable/westcoast/karplus/tb303's osc/wave/env selectors
  // visually unchanged. Flat: every discrete param is a select control (a radio
  // strip up to 4 options), which is what a drum WAVE or a sampler LOOP is.
  if (discrete && (flat || spec.selectStyle === 'dropdown')) {
    const options = spec.options!;
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(engine.getBaseValue(spec.id))));
    const { el, handle } = createSelectControl({
      id: registryId,
      label: spec.label,
      options,
      initialValue: options[idx]?.value ?? options[0].value,
      forceSelect: spec.selectStyle === 'dropdown',
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
    // Flat drags stay unquantised: knob.ts rounds to `Math.round(v/step)*step`
    // from ZERO rather than from `min`, so a step over a wide range (the
    // sampler's 20..20000 cutoff) would snap the low end below its own minimum.
    step: discrete ? 1 : (flat ? undefined : (spec.max - spec.min) / 200),
    value: engine.getBaseValue(spec.id),
    defaultValue: spec.default,
    size: opts.knobSize,
    color: spec.color,
    format: opts.formatter
      ? (v) => opts.formatter!(spec.id, v)
      : discrete
        ? (v) => spec.options![Math.max(0, Math.min(spec.options!.length - 1, Math.round(v)))].label
        // Flat knobs show a bare number: a drum-rack knob is 34px and a sampler
        // zone knob 30px, and both were approved without the declared unit
        // suffix. The grouped grid, whose knobs are full size, paints it.
        : (!flat && spec.unit ? (v) => `${v.toFixed(2)}${spec.unit}` : undefined),
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
  const specs = engine.params.filter((spec) => !skip(spec.id));

  // Flat: the CALLER owns the row element (a `.knob-row`, a `.dv-synth` block,
  // an audio-clip toolbar). Wrapping here would nest a flex row inside a flex
  // row and break the layout those screens were approved with.
  if (opts.layout === 'flat') {
    for (const spec of specs) container.appendChild(buildControl(engine, ctx, spec, opts));
    return;
  }

  const order: string[] = [];
  const byGroup = new Map<string | undefined, EngineParamSpec[]>();
  for (const spec of specs) {
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
      ? html`<div class="row knob-row">${globals.map((spec) => buildControl(engine, ctx, spec, opts))}</div>`
      : nothing}
    ${order.map((g) => html`
      <div class="row poly-section">
        <div class="section-label">${g}</div>
        <div class="knob-row">${byGroup.get(g)!.map((spec) => buildControl(engine, ctx, spec, opts))}</div>
      </div>`)}
  `, frag);
  container.appendChild(frag);
}
