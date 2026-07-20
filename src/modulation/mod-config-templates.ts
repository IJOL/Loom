// src/modulation/mod-config-templates.ts
// The per-modulator config row: LFO (wave/rate/sync/polarity/trig/scope) and
// ADSR (A/D/S/R). Knobs and select-controls are built once and held in the
// panel's ControlCache; the templates only interpolate their DOM nodes.

import { html, type TemplateResult } from 'lit-html';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import { lfoFreeRatePosToHz, lfoFreeRateHzToPos } from './rate-sync';
import { attachKnobUndo } from '../save/history-wiring';
import type { ModulatorState, Waveform } from './types';
import { type PanelCtx, sync, edit } from './mod-ui-shared';

export function lfoConfigTemplate(mod: ModulatorState, ctx: PanelCtx): TemplateResult {
  const { deps, cache } = ctx;
  const base = `${deps.laneId}.mod.${mod.id}`;

  const wave = cache.get(`${base}.waveform`, () => {
    const c = createSelectControl({
      id: `${base}.waveform`,
      label: 'WAVE',
      options: [
        { value: 'sine',     label: 'Sine' },
        { value: 'triangle', label: 'Tri'  },
        { value: 'square',   label: 'Sqr'  },
        { value: 'saw',      label: 'Saw'  },
      ],
      initialValue: mod.waveform ?? 'sine',
      onChange: (v) => edit(deps, () => { mod.waveform = v as Waveform; sync(deps); }),
    });
    deps.registerKnob(c.handle);
    return c;
  });

  // FREE rate: a 0..1 position knob with a piecewise scale (slow rates get the
  // first half — see lfoFreeRatePosToHz). Stored as Hz in mod.rateHz; displayed
  // in bpm (LFO cycles per minute).
  const rate = cache.get(`${base}.rate`, () => {
    const k = createKnob({
      id: `${base}.rate`,
      label: 'RATE',
      min: 0, max: 1, step: 0.001,
      value: lfoFreeRateHzToPos(mod.rateHz ?? 4),
      defaultValue: lfoFreeRateHzToPos(4),
      onChange: (pos) => { mod.rateHz = lfoFreeRatePosToHz(pos); sync(deps); },
      format: (pos) => {
        const b = lfoFreeRatePosToHz(pos) * 60;
        return b < 1 ? `${b.toFixed(2)} bpm` : b < 10 ? `${b.toFixed(1)} bpm` : `${Math.round(b)} bpm`;
      },
      ...(deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {}),
    });
    deps.registerKnob(k);
    return k;
  });

  const subdiv = cache.get(`${base}.syncSubdiv`, () => {
    const c = createSelectControl({
      id: `${base}.syncSubdiv`,
      label: 'FEEL',
      options: [
        { value: 'straight', label: 'Str'  },
        { value: 'triplet',  label: 'Trip' },
        { value: 'dotted',   label: 'Dot'  },
      ],
      initialValue: mod.syncSubdiv ?? 'straight',
      onChange: (v) => edit(deps, () => {
        mod.syncSubdiv = v as 'straight' | 'triplet' | 'dotted';
        sync(deps);
      }),
    });
    deps.registerKnob(c.handle);
    return c;
  });

  const bipolar = cache.get(`${base}.bipolar`, () => {
    const c = createSelectControl({
      id: `${base}.bipolar`,
      label: 'POLARITY',
      options: [
        { value: 'uni', label: '0..1'   },
        { value: 'bi',  label: '-1..+1' },
      ],
      initialValue: (mod.bipolar !== false) ? 'bi' : 'uni',
      onChange: (v) => edit(deps, () => { mod.bipolar = v === 'bi'; sync(deps); }),
    });
    deps.registerKnob(c.handle);
    return c;
  });

  const trigger = cache.get(`${base}.trigger`, () => {
    const c = createSelectControl({
      id: `${base}.trigger`,
      label: 'TRIG',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'note', label: 'Note' },
      ],
      initialValue: mod.trigger ?? 'free',
      onChange: (v) => edit(deps, () => { mod.trigger = v as 'free' | 'note'; sync(deps); }),
    });
    deps.registerKnob(c.handle);
    return c;
  });

  // SCOPE: shared (one engine-wide LFO) vs per-voice (one LFO per note).
  const scope = cache.get(`${base}.scope`, () => {
    const c = createSelectControl({
      id: `${base}.scope`,
      label: 'SCOPE',
      options: [
        { value: 'shared',    label: 'Shared'   },
        { value: 'per-voice', label: 'PerVoice' },
      ],
      initialValue: mod.scope ?? 'shared',
      onChange: (v) => {
        edit(deps, () => {
          mod.scope = v as 'shared' | 'per-voice';
          sync(deps);
          // The engine respawns modulator voices in the new scope. Note this
          // also does `container.innerHTML = ''` + buildParamUI, so the whole
          // panel — this host included — is rebuilt from scratch right here.
          deps.onChange();
        });
        // NO ctx.rerender() here. It looked like belt-and-braces but `onChange`
        // above has already destroyed the host this closure captured, so the
        // repaint landed on a detached node nobody sees. TRIG visibility is
        // correct because the rebuild re-evaluates `mod.scope` — the same
        // reason it worked before the lit-html migration.
      },
    });
    deps.registerKnob(c.handle);
    return c;
  });

  const commitBars = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const v = parseFloat(input.value);
    if (!isFinite(v) || v <= 0) {
      input.value = String(mod.syncBars ?? 0.25);
      return;
    }
    edit(deps, () => { mod.syncBars = v; sync(deps); });
  };

  const perVoice = (mod.scope ?? 'shared') === 'per-voice';

  return html`
    <div class="mod-card-config">
      ${wave.el}
      <div class="mod-slot" ?hidden=${mod.syncToBpm}>${rate.el}</div>
      <div class="mod-slot" ?hidden=${!mod.syncToBpm}>
        <div class="knob mod-bars">
          <div class="knob-label">BARS</div>
          <input
            class="mod-bars-field"
            type="number"
            min="0.0625"
            max="64"
            step="0.0625"
            .value=${String(mod.syncBars ?? 0.25)}
            @change=${commitBars}
          />
        </div>
      </div>
      <div class="mod-slot" ?hidden=${!mod.syncToBpm}>${subdiv.el}</div>
      <button
        class=${mod.syncToBpm ? 'rnd primary' : 'rnd'}
        @click=${() => {
          edit(deps, () => { mod.syncToBpm = !mod.syncToBpm; sync(deps); });
          ctx.rerender();
        }}
      >${mod.syncToBpm ? 'SYNC' : 'FREE'}</button>
      ${bipolar.el}
      <div class="mod-slot" ?hidden=${perVoice}>${trigger.el}</div>
      ${scope.el}
    </div>
  `;
}

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
    <div class="mod-card-config">
      ${knob('attackSec',  'A', 0.001, 2, 0.01, fmtTime).el}
      ${knob('decaySec',   'D', 0.001, 4, 0.3,  fmtTime).el}
      ${knob('sustain',    'S', 0,     1, 0.7,  (v) => `${Math.round(v * 100)}%`).el}
      ${knob('releaseSec', 'R', 0.001, 8, 0.3,  fmtTime).el}
    </div>
  `;
}
