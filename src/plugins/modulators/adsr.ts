// src/plugins/modulators/adsr.ts
import { html, type TemplateResult } from 'lit-html';
import { ADSRVoice } from '../../modulation/adsr-voice';
import { createKnob } from '../../core/knob';
import { attachKnobUndo } from '../../save/history-wiring';
import type { ModulatorState } from '../../modulation/types';
import { registerModulator } from '../../modulation/modulator-registry';
import { type PanelCtx, sync } from '../../modulation/mod-ui-shared';

/** Fresh ADSR state for a new instance. Moved from modulation/types.ts — the
 *  ADSR component owns its own defaults now; the registry's `defaultState`
 *  below is the only door callers should use to reach it. */
export function makeDefaultADSR(id: string): ModulatorState {
  return {
    id, kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.01, decaySec: 0.3, sustain: 0.7, releaseSec: 0.3,
    scope: 'per-voice',
  };
}

// The per-modulator config row: A/D/S/R. Knobs are built once and held in the
// panel's ControlCache; the template only interpolates their DOM nodes.
export function adsrConfigTemplate(mod: ModulatorState, ctx: PanelCtx): TemplateResult {
  const { deps, cache } = ctx;
  const base = `${deps.laneId}.mod.${mod.id}`;

  const fmtTime = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;

  const knob = (
    field: 'attackSec' | 'decaySec' | 'sustain' | 'releaseSec',
    label: string, min: number, max: number, def: number,
    format: (v: number) => string,
  ) => cache.get(`${base}.${field}`, () => {
    const k = createKnob({
      id: `${base}.${field}`,
      label, min, max, step: 0.001,
      value: (mod[field] as number | undefined) ?? def,
      defaultValue: def,
      onChange: (v) => { mod[field] = v; sync(deps); },
      format,
      ...(deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {}),
    });
    deps.registerKnob(k);
    return k;
  });

  return html`
    <div class="mod-card-config mod-adsr-config">
      ${knob('attackSec',  'A', 0.001, 2, 0.01, fmtTime).el}
      ${knob('decaySec',   'D', 0.001, 4, 0.3,  fmtTime).el}
      ${knob('sustain',    'S', 0,     1, 0.7,  (v) => `${Math.round(v * 100)}%`).el}
      ${knob('releaseSec', 'R', 0.001, 8, 0.3,  fmtTime).el}
    </div>
  `;
}

registerModulator({
  id: 'adsr',
  name: 'ADSR',
  driver: 'gate',
  scopes: ['per-voice'],
  idPrefix: 'adsr',
  defaultState: (id) => makeDefaultADSR(id),
  configTemplate: (mod, ctx) => adsrConfigTemplate(mod, ctx),
  createVoice: (ctx, { state }) => new ADSRVoice(ctx, state),
});
