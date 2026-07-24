// Per-lane FX panel: the COMP subsection (channel compressor) and the SC
// subsection (sidechain source + depth/attack/release).
//
// Rendered with mountPanel (lit-panel.ts): the template repaints on BYP and
// sidechain-source changes instead of imperatively toggling classes/display.
// Knobs and the SRC select are imperative widgets held in the panel's
// ControlCache and interpolated by node. Each mountLaneFxPanel call passes a
// fresh opts object, so the cache resets per mount and every knob is rebuilt
// AND re-registered — the engine-switch flow depends on that (it prefix-
// unregisters `<laneId>.*` before remounting).

import { html, nothing, type TemplateResult } from 'lit-html';
import { mountPanel, type PanelHandle } from './lit-panel';
import { renderElement } from './lit-fragment';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';
import type { ChannelStrip } from './fx';
import type { SidechainBus } from './sidechain-bus';

const COMP_COLOR = '#1abc9c';
const SC_COLOR   = '#e74c3c';
const KNOB_SIZE  = 32;

const fmtPct   = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb    = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;
const fmtMs    = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
const fmtMult  = (v: number) => `${v.toFixed(2)}×`;

const HOST_CLASS = 'lane-fx-host';

export interface LaneFxPanelOpts {
  laneId: string;
  strip: ChannelStrip;
  bus: SidechainBus;
  parent: HTMLElement;
  registerKnob: (k: KnobHandle) => void;
  historyDeps?: HistoryDeps;
  lookupLabel?: (laneId: string) => string | undefined;
}

interface KnobCfg {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue?: number;
  color: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

type Ctx = PanelHandle<LaneFxPanelOpts>;

/** Cached knob keyed by its automation id: built (and registered) once per
 *  mount, then only interpolated on repaints. `cfg.value` is the build-time
 *  seed — later repaints never write it back, same as the old one-shot DOM. */
function knob(ctx: Ctx, cfg: KnobCfg): KnobHandle {
  const opts = ctx.deps;
  return ctx.cache.get(cfg.id, () => {
    const undoHooks = opts.historyDeps ? attachKnobUndo(opts.historyDeps) : {};
    const k = createKnob({ ...cfg, size: KNOB_SIZE, ...undoHooks });
    opts.registerKnob(k);
    return k;
  });
}

function compTemplate(ctx: Ctx): TemplateResult {
  const { laneId, strip } = ctx.deps;
  const st = strip.getCompState();

  return html`
    <div class="row poly-section lane-fx-comp">
      <div class="section-label">COMP</div>
      <div class="knob-row">
        ${knob(ctx, {
          id: `${laneId}.fx.comp.thr`, label: 'THR', min: -60, max: 0, step: 0.5,
          value: st.threshold, defaultValue: -24, color: COMP_COLOR, format: fmtDb,
          onChange: (v) => strip.setCompState({ threshold: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.rat`, label: 'RAT', min: 1, max: 20, step: 0.1,
          value: st.ratio, defaultValue: 4, color: COMP_COLOR, format: fmtRatio,
          onChange: (v) => strip.setCompState({ ratio: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.atk`, label: 'ATK', min: 0.001, max: 1, step: 0.001,
          value: st.attack, defaultValue: 0.003, color: COMP_COLOR, format: fmtMs,
          onChange: (v) => strip.setCompState({ attack: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.rel`, label: 'REL', min: 0.001, max: 1, step: 0.001,
          value: st.release, defaultValue: 0.25, color: COMP_COLOR, format: fmtMs,
          onChange: (v) => strip.setCompState({ release: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.knee`, label: 'KNEE', min: 0, max: 40, step: 0.5,
          value: st.knee, defaultValue: 30, color: COMP_COLOR, format: fmtDb,
          onChange: (v) => strip.setCompState({ knee: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.mkup`, label: 'MKUP', min: 0, max: 4, step: 0.01,
          value: st.makeup, defaultValue: 1, color: COMP_COLOR, format: fmtMult,
          onChange: (v) => strip.setCompState({ makeup: v }),
        }).el}
        <button
          class=${st.bypass ? 'rnd lane-fx-bypass active' : 'rnd lane-fx-bypass'}
          @click=${() => {
            strip.setCompState({ bypass: !strip.getCompState().bypass });
            ctx.rerender();
          }}
        >BYP</button>
      </div>
    </div>
  `;
}

function scTemplate(ctx: Ctx): TemplateResult {
  const { laneId, strip, bus, lookupLabel } = ctx.deps;
  const current = (): import('./comp-state').SidechainState | null => strip.getSidechain();

  // The SRC select is built once per mount (the source list is a mount-time
  // snapshot), cached like a knob: repaints only interpolate the node, so they
  // can neither reset the user's selection nor rebuild the option list.
  const sel = ctx.cache.get(`${laneId}.fx.sc.src`, () => {
    const onChange = (e: Event) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      const cur = current() ?? { ...DEFAULT_SIDECHAIN_STATE };
      if (v === '') strip.setSidechain(bus, null);
      else          strip.setSidechain(bus, { ...cur, source: v });
      ctx.rerender(); // repaint shows/hides the DEPTH/ATK/REL knobs
    };
    const el = renderElement<HTMLSelectElement>(html`
      <select class="lane-fx-sc-src" @change=${onChange}>
        <option value="">off</option>
        ${bus.listSources(laneId).map((src) =>
          html`<option value=${src.id}>${lookupLabel?.(src.id) ?? src.label ?? src.id}</option>`)}
      </select>
    `);
    el.value = current()?.source ?? '';
    return el;
  });

  const scKnob = (cfg: KnobCfg) => knob(ctx, cfg).el;

  return html`
    <div class="row poly-section lane-fx-sc">
      <div class="section-label">SC</div>
      <div class="knob-row">
        ${sel}
        <div class="lane-fx-sc-knobs" style=${current()?.source ? nothing : 'display:none'}>
          ${scKnob({
            id: `${laneId}.fx.sc.depth`, label: 'DEPTH', min: 0, max: 1, step: 0.01,
            value: current()?.depth ?? 0.6, defaultValue: 0.6, color: SC_COLOR, format: fmtPct,
            onChange: (v) => {
              const cur = current(); if (!cur) return;
              strip.setSidechain(bus, { ...cur, depth: v });
            },
          })}
          ${scKnob({
            id: `${laneId}.fx.sc.atk`, label: 'ATK', min: 0.001, max: 0.5, step: 0.001,
            value: current()?.attack ?? 0.005, defaultValue: 0.005, color: SC_COLOR, format: fmtMs,
            onChange: (v) => {
              const cur = current(); if (!cur) return;
              strip.setSidechain(bus, { ...cur, attack: v });
            },
          })}
          ${scKnob({
            id: `${laneId}.fx.sc.rel`, label: 'REL', min: 0.005, max: 1, step: 0.005,
            value: current()?.release ?? 0.25, defaultValue: 0.25, color: SC_COLOR, format: fmtMs,
            onChange: (v) => {
              const cur = current(); if (!cur) return;
              strip.setSidechain(bus, { ...cur, release: v });
            },
          })}
        </div>
      </div>
    </div>
  `;
}

export function mountLaneFxPanel(opts: LaneFxPanelOpts): void {
  // Contract: each mount replaces whatever the parent held (engine editors
  // leave stale content in this slot). The wipe also detaches any previous
  // panel host, so mountPanel re-adopts with a fresh host + cache below.
  opts.parent.innerHTML = '';
  mountPanel({
    container: opts.parent,
    className: HOST_CLASS,
    deps: opts,
    template: (h) => html`${compTemplate(h)}${scTemplate(h)}`,
  });
}
