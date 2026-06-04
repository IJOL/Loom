// src/engines/engine-ui.ts
// Shared helper that walks an engine's params and builds the matching
// knob/select controls, registering each under the canonical
// `<laneId>.<spec.id>` automation id via the lane's EngineUIContext.
//
// Used by:
//   - main.ts's wireLaneKnobs (TB-303 + Subtractive 'main' lanes)
//   - each engine's buildParamUI() (Wavetable, FM, Karplus, Drums)
// so every engine that registers params through the same path ends up with
// canonical, modulator-routable ids.

import type { SynthEngine, EngineUIContext } from './engine-types';
import { createKnob, type KnobHandle } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import { mirrorParamChange } from '../session/session-engine-state';
import { attachKnobUndo } from '../save/history-wiring';

export interface WireEngineParamsOptions {
  /** Optional value formatter, keyed by spec.id. */
  formatter?: (id: string, v: number) => string;
  /** Optional element predicate — if returns false, the spec is skipped. */
  filter?: (specId: string) => boolean;
  /** Knob SVG size in px (continuous params only). Default: createKnob's 40. */
  knobSize?: number;
}

/**
 * Walk engine.params, build a knob or select per spec, and append it to
 * `parent`. Each control is registered with `ctx.registerKnob` under the
 * canonical id `${ctx.laneId}.${spec.id}` so it shows up in the modulation
 * destination dropdown and automation registry.
 */
export function wireEngineParams(
  engine: SynthEngine,
  ctx: EngineUIContext,
  parent: HTMLElement,
  opts: WireEngineParamsOptions = {},
): void {
  for (const spec of engine.params) {
    if (opts.filter && !opts.filter(spec.id)) continue;
    const registryId = `${ctx.laneId}.${spec.id}`;

    if (spec.kind === 'continuous') {
      const k: KnobHandle = createKnob({
        id: registryId,
        label: spec.label,
        min: spec.min,
        max: spec.max,
        value: engine.getBaseValue(spec.id),
        defaultValue: spec.default,
        size: opts.knobSize,
        onChange: (v) => {
          engine.setBaseValue(spec.id, v);
          if (ctx.sessionState) {
            mirrorParamChange(ctx.sessionState, ctx.laneId, spec.id, v);
          }
        },
        format: opts.formatter ? (v) => opts.formatter!(spec.id, v) : undefined,
        ...(ctx.historyDeps ? attachKnobUndo(ctx.historyDeps) : {}),
      });
      ctx.registerKnob(k);
      parent.appendChild(k.el);
    } else {
      const options = spec.options ?? [];
      const idx = Math.round(engine.getBaseValue(spec.id));
      const initialValue = options[idx]?.value ?? options[0]?.value ?? '';
      const { el, handle } = createSelectControl({
        id: registryId,
        label: spec.label,
        options,
        initialValue,
        forceSelect: spec.selectStyle === 'dropdown',
        onChange: (v) => {
          const i = options.findIndex((o) => o.value === v);
          engine.setBaseValue(spec.id, i);
          if (ctx.sessionState) {
            mirrorParamChange(ctx.sessionState, ctx.laneId, spec.id, i);
          }
        },
      });
      ctx.registerKnob(handle);
      parent.appendChild(el);
    }
  }
}
