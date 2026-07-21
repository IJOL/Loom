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

  // RETRIG + SCOPE, merged into one 3-way control. TRIG (free/note) is the
  // retrigger of a SHARED lane LFO; per-voice ("Voice") gives each note its own
  // LFO, where a retrigger is redundant — the LFO is born with the note. So the
  // three real states are Free / Note / Voice. Merging them means nothing ever
  // hides, so the row can't reflow the way a disappearing TRIG used to make it.
  const retrigValue = (mod.scope ?? 'shared') === 'per-voice'
    ? 'voice'
    : (mod.trigger === 'note' ? 'note' : 'free');
  const retrig = cache.get(`${base}.retrig`, () => {
    const c = createSelectControl({
      id: `${base}.retrig`,
      label: 'RETRIG',
      options: [
        { value: 'free',  label: 'Free'  },
        { value: 'note',  label: 'Note'  },
        { value: 'voice', label: 'Voice' },
      ],
      initialValue: retrigValue,
      onChange: (v) => {
        const prevScope = mod.scope ?? 'shared';
        edit(deps, () => {
          if (v === 'voice') {
            mod.scope = 'per-voice';
          } else {
            mod.scope = 'shared';
            mod.trigger = v as 'free' | 'note';
          }
          sync(deps);
          // A SCOPE change (to/from per-voice) respawns the modulator's voices,
          // so it needs the engine rebuild. A pure Free↔Note change only alters
          // the shared LFO's phase origin, which the live push (sync) already
          // carries — no rebuild, so the strip's own click-state stays put.
          if ((mod.scope ?? 'shared') !== prevScope) deps.onChange();
        });
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

  // Two deliberate lines, not a wrap. Line 1 is everything about RATE — the
  // waveform, the FREE/SYNC toggle, and its knob (free) or BARS+FEEL (sync).
  // Line 2 is the rest: POLARITY and the merged RETRIG. The mode-variable zone
  // sits at the END of line 1, so switching FREE↔SYNC grows/shrinks it without
  // pushing anything or leaving a reserved gap.
  return html`
    <div class="mod-card-config mod-lfo-lines">
      <div class="mcc-line">
        ${wave.el}
        <button
          class=${mod.syncToBpm ? 'rnd primary' : 'rnd'}
          @click=${() => {
            edit(deps, () => { mod.syncToBpm = !mod.syncToBpm; sync(deps); });
            ctx.rerender();
          }}
        >${mod.syncToBpm ? 'SYNC' : 'FREE'}</button>
        <div class="mod-rate-end">
          ${mod.syncToBpm
            ? html`
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
                ${subdiv.el}`
            : rate.el}
        </div>
      </div>
      <div class="mcc-line">
        ${bipolar.el}
        ${retrig.el}
      </div>
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
    <div class="mod-card-config mod-adsr-config">
      ${knob('attackSec',  'A', 0.001, 2, 0.01, fmtTime).el}
      ${knob('decaySec',   'D', 0.001, 4, 0.3,  fmtTime).el}
      ${knob('sustain',    'S', 0,     1, 0.7,  (v) => `${Math.round(v * 100)}%`).el}
      ${knob('releaseSec', 'R', 0.001, 8, 0.3,  fmtTime).el}
    </div>
  `;
}
