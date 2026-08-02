// src/engines/engine-param-grid.ts
// THE builder that turns an engine's EngineParamSpec[] into UI controls: one
// knob (continuous) or select control (discrete) per spec, registered under
// the canonical `<laneId>.<spec.id>` so modulation/automation pickers can
// address it, with undo attached.
//
// THE rule for a discrete param, on EVERY surface that draws one — both
// layouts below, AND the FX insert rack (src/session/lane-insert-ui.ts) —
// comes from one function, createSelectControl (src/core/select-control.ts):
// discrete always renders a select control, NEVER a knob; ≤4 options draw a
// radio strip; more than that, or `selectStyle: 'dropdown'`, draw a native
// <select>. A knob is for continuous params only. This builder always passes
// `compact: true`, the modifier that stacks a ≤4-option strip VERTICALLY —
// that modifier is scoped to here and the FX insert rack ONLY; a modulator's
// own config card (hand-built, or generic-mod-config.ts for a plugin's
// declared params) must leave it unset, see select-control.ts's header.
// This builder also defaults `showLabel` to true — a discrete control always
// carries its name above it, exactly like a knob's `.knob-label` — unless the
// spec opts out with `showLabel: false`. That default is set HERE, not inside
// createSelectControl, whose own default stays off (see select-control.ts's
// header): a caption was missing on every discrete control in the grid until
// this was added, while every knob beside it kept its own label.
//
// Two layouts, both approved and both still shipping:
//   'grouped' (default) — rows built by resolveParamRows (engine-param-groups.ts)
//     from the engine's declared `groups` table (order, titles, colour, which
//     sections share a row) plus each spec's `group` key; quantised drag.
//     The worklet lane pages.
//   'flat' — controls appended straight into the caller's own row,
//     unquantised. The drum rack, the sampler pads, the audio-clip toolbar.
//     This layout used to be a SECOND copy of the whole walk (the deleted
//     engine-ui.wireEngineParams), which is how the two drifted apart on
//     units, step and index clamping.
// Every value write goes through commitParam (engine-param-commit.ts) so the
// edit reaches BOTH the engine and lane.engineState.params — the grid used to
// call setBaseValue directly, which is why an fm/wavetable/westcoast/
// tb303 knob was thrown away on save.

import { html, render, nothing } from 'lit-html';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import type { EngineParamSpec } from './engine-params';
import { isStripParamId } from '../core/channel-strip-params';
import type { EngineUIContext } from './engine-types';
import { attachKnobUndo } from '../save/history-wiring';
import { commitParam } from './engine-param-commit';
import { resolveParamRows, type EngineParamGroup } from './engine-param-groups';

interface GridEngine {
  id: string;
  params: EngineParamSpec[];
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  /** Declared layout for this engine's params. Absent → first-appearance order,
   *  one row per group, no colour: what every engine did before groups existed. */
  groups?: EngineParamGroup[];
}

export interface BuildGridOpts {
  /** If it returns true for a spec id, that spec is omitted. */
  skip?: (id: string) => boolean;
  /** Knob SVG size in px (continuous params only). Default: createKnob's own. */
  knobSize?: number;
  /** Value-readout formatter keyed by spec id. Wins over `spec.unit`. */
  formatter?: (specId: string, v: number) => string;
  /**
   * 'grouped' (default): rows built from the engine's declared `groups` table
   * (see resolveParamRows), quantised drags.
   * 'flat': controls are appended straight into the caller's own row, in
   * declaration order, unquantised. That is the approved look of the drum
   * rack, the sampler pads and the audio-clip toolbar, which used to get it
   * from a second spec-walking builder.
   * Discrete params render IDENTICALLY in both — see this file's header and
   * buildControl for the one rule that holds regardless of layout.
   */
  layout?: 'grouped' | 'flat';
}

function buildControl(
  engine: GridEngine, ctx: EngineUIContext, spec: EngineParamSpec, opts: BuildGridOpts,
  sectionColor?: string,
): HTMLElement {
  const registryId = `${ctx.laneId}.${spec.id}`;
  const flat = opts.layout === 'flat';
  const discrete = spec.kind === 'discrete' && !!spec.options && spec.options.length > 0;

  // A discrete param ALWAYS renders as a select control — a vertical radio
  // strip (≤4 options) or a native <select> (more, or `selectStyle:
  // 'dropdown'`) — in BOTH layouts. No discrete param ever renders as a knob;
  // a knob is for continuous params only. See this file's header for the
  // full rule, which also covers the FX insert rack.
  if (discrete) {
    const options = spec.optionsFrom
      ? spec.optionsFrom.build(engine.getBaseValue(spec.optionsFrom.paramId))
      : spec.options!;
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(engine.getBaseValue(spec.id))));
    const { el, handle } = createSelectControl({
      id: registryId,
      label: spec.label,
      options,
      initialValue: options[idx]?.value ?? options[0].value,
      forceSelect: spec.selectStyle === 'dropdown',
      // Every discrete control in the grid carries its name, exactly like a
      // knob's `.knob-label` — default ON here (unlike createSelectControl's
      // own default, which stays off for callers that don't want it, e.g. the
      // FX insert rack). A spec can still opt out with `showLabel: false`.
      showLabel: spec.showLabel !== false,
      compact: true,
      onChange: (v) => {
        const i = options.findIndex((o) => o.value === v);
        commitParam(engine, ctx, spec.id, Math.max(0, i));
        // If another param's options are derived from this one, its control is
        // now showing a stale list — rebuild the grid rather than surgically
        // replacing it (the caller already rebuilds on engine swap).
        if (engine.params.some((s) => s.optionsFrom?.paramId === spec.id)) ctx.rebuildParamUI?.();
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
    step: flat ? undefined : (spec.max - spec.min) / 200,
    value: engine.getBaseValue(spec.id),
    defaultValue: spec.default,
    size: opts.knobSize,
    color: spec.color ?? sectionColor,
    format: opts.formatter
      ? (v) => opts.formatter!(spec.id, v)
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
  // The lane's seven mixer-strip params are declared by every engine (that is how
  // they became automation destinations), but they are NOT the engine's editor:
  // their controls are the lane's mixer column, and drawing a second LEVEL / PAN
  // / A / B / LO / MID / HI here would duplicate every one of them — same id, so
  // the two copies would fight over the registry entry that automation drives.
  //
  // Callers that DO own a strip surface pass their own ids through `skip`; the
  // drums voice rack is one, and it keeps working because it filters by voice
  // prefix, not by this.
  const specs = engine.params.filter((spec) => !skip(spec.id) && !isStripParamId(spec.id));

  // Flat: the CALLER owns the row element (a `.knob-row`, a `.dv-synth` block,
  // an audio-clip toolbar). Wrapping here would nest a flex row inside a flex
  // row and break the layout those screens were approved with.
  if (opts.layout === 'flat') {
    for (const spec of specs) container.appendChild(buildControl(engine, ctx, spec, opts));
    return;
  }

  // The grid is a one-shot build (the caller rebuilds the whole param UI on
  // engine swap), so the rows render once into a fragment — no panel lifecycle
  // needed — and the fragment is appended after the caller's existing children
  // (e.g. the POLY header). Controls stay imperative widgets; the templates
  // only interpolate their elements. Row/section shape comes from
  // resolveParamRows, driven by the engine's own `groups` table: ungrouped
  // params first, then each declared group (title, colour, row-packing),
  // then any group a spec references but nobody declared, in first-appearance
  // order — an engine with no table renders exactly as it did before groups
  // were declarable at all.
  const rows = resolveParamRows(specs, engine.groups);
  const frag = document.createDocumentFragment();
  render(html`
    ${rows.map((row) => {
      // A row holding a single unlabelled section is the leading globals row,
      // which has no header and no divider — unchanged from before.
      const bare = row.sections.length === 1 && row.sections[0].title === undefined;
      return bare
        ? html`<div class="row knob-row">
            ${row.sections[0].specs.map((s) => buildControl(engine, ctx, s, opts))}
          </div>`
        : html`<div class="row poly-section">
            ${row.sections.map((section, i) => html`
              ${i > 0 ? html`<div class="vert-divider"></div>` : nothing}
              <div class="section-label">${section.title}</div>
              <div class="knob-row">
                ${section.specs.map((s) => buildControl(engine, ctx, s, opts, section.color))}
              </div>`)}
          </div>`;
    })}
  `, frag);
  container.appendChild(frag);
}
