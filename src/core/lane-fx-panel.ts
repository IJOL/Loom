// Per-lane FX panel: the COMP subsection (channel compressor) and the SC
// subsection (sidechain source + depth/attack/release).
//
// Rendered with mountPanel (lit-panel.ts): the template repaints on BYP and
// sidechain-source changes instead of imperatively toggling classes/display.
// Knobs, the SRC select, the state text, the "?" help pairs and the GR meter are
// imperative widgets held in the panel's ControlCache and interpolated by node.
// Each mountLaneFxPanel call passes a fresh opts object, so the cache resets per
// mount and every knob is rebuilt AND re-registered — the engine-switch flow
// depends on that (it prefix-unregisters `<laneId>.*` before remounting).
//
// Both sections are meant to explain themselves without a manual: a readable
// subtitle, a "?" legend (the same createHelpButton the clip editors use), a
// tooltip per control, a line of text saying what the sidechain is wired to
// right now, and a gain-reduction bar so the compressor's work is visible.
// All the wording lives in lane-fx-help.ts.

import { html, type TemplateResult } from 'lit-html';
import { mountPanel, type PanelHandle } from './lit-panel';
import { renderElement } from './lit-fragment';
import { createKnob, type KnobHandle } from './knob';
import { createHelpButton } from './clip-editor-toolbar';
import { createGrMeter } from './gr-meter';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { DEFAULT_SIDECHAIN_STATE, type SidechainState } from './comp-state';
import { COMP_LEGEND, COMP_TIPS, GR_TIP, SC_LEGEND, SC_TIPS } from './lane-fx-help';
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

// Teardown of whichever lane FX panel is live — owned per MODULE, not per
// container, and that is the point. mountPanel's cleanup slot is keyed on the
// CONTAINER, and this panel has one per page (knob-mounting resolves
// `[data-page="303|drums|poly"] .lane-fx-knobs`), so moving the active lane to
// another page mounts into a slot whose cleanup starts empty and the old page's
// GR frame loop would run for the rest of the session. The meter's self-park
// can't see it either: a hidden page is display:none, still `isConnected`.
// Exactly ONE panel is ever live — a page only becomes visible through editLane,
// which remounts this panel for the lane it shows — so "the previous mount,
// wherever it was" is the right ownership unit.
let livePanelTeardown: (() => void) | undefined;

/** Tears down the live panel's frame loops. Every mount calls it first; exported
 *  so a host that drops the panel for good can reclaim it too. Idempotent. */
export function disposeLaneFxPanel(): void {
  const fn = livePanelTeardown;
  livePanelTeardown = undefined;
  fn?.();
}

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
  /** Native tooltip: what the knob means, with its unit. Not optional — a
   *  four-letter label is not self-explanatory and that was the complaint. */
  title: string;
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
 *  seed — later repaints never write it back, same as the old one-shot DOM.
 *  createKnob has no tooltip option, so the title goes on its element. */
function knob(ctx: Ctx, cfg: KnobCfg): KnobHandle {
  const opts = ctx.deps;
  return ctx.cache.get(cfg.id, () => {
    const undoHooks = opts.historyDeps ? attachKnobUndo(opts.historyDeps) : {};
    const k = createKnob({ ...cfg, size: KNOB_SIZE, ...undoHooks });
    k.el.title = cfg.title;
    opts.registerKnob(k);
    return k;
  });
}

/** Section header: the short name plus a line of plain English under it. */
function sectionHead(title: string, sub: string): TemplateResult {
  return html`
    <div class="section-label lane-fx-label">
      <span class="lane-fx-title">${title}</span>
      <span class="lane-fx-sub">${sub}</span>
    </div>
  `;
}

/** Cached "?" button + popover pair. Cached so an open popover survives a
 *  repaint (a rebuilt pair would snap shut on every BYP click). */
function helpPair(ctx: Ctx, key: string, legend: string) {
  return ctx.cache.get(key, () => {
    const pair = createHelpButton(legend);
    pair.popover.classList.add('lane-fx-help-popover');
    return pair;
  });
}

/** The gain-reduction bar. Built once per mount; its dispose() becomes the
 *  module's live teardown, which the NEXT mount runs first — whichever page that
 *  mount lands on. Registered inside the create-once factory on purpose: doing it
 *  on every repaint would re-register a teardown for a meter that is already the
 *  live one. Deliberately NOT ctx.setCleanup: that slot is per container, which
 *  is exactly the case this panel does not satisfy (see livePanelTeardown). */
function grMeterEl(ctx: Ctx): HTMLElement {
  const { laneId, strip } = ctx.deps;
  return ctx.cache.get(`${laneId}.fx.comp.gr`, () => {
    const meter = createGrMeter({ source: strip, title: GR_TIP });
    livePanelTeardown = () => meter.dispose();
    return meter;
  }).el;
}

/** What the sidechain is doing right now, in words. Pure — the panel shows it
 *  next to the SRC dropdown so the wiring is readable without opening it. */
export function sidechainSummary(
  sc: SidechainState | null,
  label: (id: string) => string,
): string {
  if (!sc || !sc.source) return 'off';
  return `${label(sc.source)} → duck ${Math.round(sc.depth * 100)}%`;
}

function compTemplate(ctx: Ctx): TemplateResult {
  const { laneId, strip } = ctx.deps;
  const st = strip.getCompState();
  const help = helpPair(ctx, `${laneId}.fx.comp.help`, COMP_LEGEND);

  return html`
    <div class="row poly-section lane-fx-comp">
      ${sectionHead('COMP', 'channel compressor')}
      ${help.btn}
      <div class="knob-row">
        ${knob(ctx, {
          id: `${laneId}.fx.comp.thr`, label: 'THR', title: COMP_TIPS.thr,
          min: -60, max: 0, step: 0.5,
          value: st.threshold, defaultValue: -24, color: COMP_COLOR, format: fmtDb,
          onChange: (v) => strip.setCompState({ threshold: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.rat`, label: 'RAT', title: COMP_TIPS.rat,
          min: 1, max: 20, step: 0.1,
          value: st.ratio, defaultValue: 4, color: COMP_COLOR, format: fmtRatio,
          onChange: (v) => strip.setCompState({ ratio: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.atk`, label: 'ATK', title: COMP_TIPS.atk,
          min: 0.001, max: 1, step: 0.001,
          value: st.attack, defaultValue: 0.003, color: COMP_COLOR, format: fmtMs,
          onChange: (v) => strip.setCompState({ attack: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.rel`, label: 'REL', title: COMP_TIPS.rel,
          min: 0.001, max: 1, step: 0.001,
          value: st.release, defaultValue: 0.25, color: COMP_COLOR, format: fmtMs,
          onChange: (v) => strip.setCompState({ release: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.knee`, label: 'KNEE', title: COMP_TIPS.knee,
          min: 0, max: 40, step: 0.5,
          value: st.knee, defaultValue: 30, color: COMP_COLOR, format: fmtDb,
          onChange: (v) => strip.setCompState({ knee: v }),
        }).el}
        ${knob(ctx, {
          id: `${laneId}.fx.comp.mkup`, label: 'MKUP', title: COMP_TIPS.mkup,
          min: 0, max: 4, step: 0.01,
          value: st.makeup, defaultValue: 1, color: COMP_COLOR, format: fmtMult,
          onChange: (v) => strip.setCompState({ makeup: v }),
        }).el}
        ${grMeterEl(ctx)}
        <button
          class=${st.bypass ? 'rnd lane-fx-bypass active' : 'rnd lane-fx-bypass'}
          title=${COMP_TIPS.byp}
          @click=${() => {
            strip.setCompState({ bypass: !strip.getCompState().bypass });
            ctx.rerender();
          }}
        >BYP</button>
      </div>
      ${help.popover}
    </div>
  `;
}

function scTemplate(ctx: Ctx): TemplateResult {
  const { laneId, strip, bus, lookupLabel } = ctx.deps;
  const current = (): SidechainState | null => strip.getSidechain();
  const help = helpPair(ctx, `${laneId}.fx.sc.help`, SC_LEGEND);
  const sources = bus.listSources(laneId);
  const labelFor = (id: string) =>
    lookupLabel?.(id) ?? sources.find((s) => s.id === id)?.label ?? id;

  // The SRC select is built once per mount (the source list is a mount-time
  // snapshot), cached like a knob: repaints only interpolate the node, so they
  // can neither reset the user's selection nor rebuild the option list.
  const sel = ctx.cache.get(`${laneId}.fx.sc.src`, () => {
    const onChange = (e: Event) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      const cur = current() ?? { ...DEFAULT_SIDECHAIN_STATE };
      if (v === '') strip.setSidechain(bus, null);
      else          strip.setSidechain(bus, { ...cur, source: v });
      ctx.rerender(); // repaint reveals/hides the DEPTH/ATK/REL knobs + state text
    };
    const el = renderElement<HTMLSelectElement>(html`
      <select class="lane-fx-sc-src" title=${SC_TIPS.src} @change=${onChange}>
        <option value="">off</option>
        ${sources.map((src) =>
          html`<option value=${src.id}>${lookupLabel?.(src.id) ?? src.label ?? src.id}</option>`)}
      </select>
    `);
    el.value = current()?.source ?? '';
    return el;
  });

  // Live state readout. Cached (never re-templated) so the DEPTH knob can
  // refresh it per drag frame without a template diff.
  const stateEl = ctx.cache.get(`${laneId}.fx.sc.state`, () =>
    renderElement<HTMLElement>(html`<span class="lane-fx-sc-state"></span>`));
  const refreshState = () => { stateEl.textContent = sidechainSummary(current(), labelFor); };
  refreshState();

  const scKnob = (cfg: KnobCfg) => knob(ctx, cfg).el;

  return html`
    <div class="row poly-section lane-fx-sc">
      ${sectionHead('SIDECHAIN', 'duck this lane')}
      ${help.btn}
      <div class="knob-row">
        ${sel}
        ${stateEl}
        <div class="lane-fx-sc-knobs" ?hidden=${!current()?.source}>
          ${scKnob({
            id: `${laneId}.fx.sc.depth`, label: 'DEPTH', title: SC_TIPS.depth,
            min: 0, max: 1, step: 0.01,
            value: current()?.depth ?? 0.6, defaultValue: 0.6, color: SC_COLOR, format: fmtPct,
            onChange: (v) => {
              const cur = current(); if (!cur) return;
              strip.setSidechain(bus, { ...cur, depth: v });
              refreshState();
            },
          })}
          ${scKnob({
            id: `${laneId}.fx.sc.atk`, label: 'ATK', title: SC_TIPS.atk,
            min: 0.001, max: 0.5, step: 0.001,
            value: current()?.attack ?? 0.005, defaultValue: 0.005, color: SC_COLOR, format: fmtMs,
            onChange: (v) => {
              const cur = current(); if (!cur) return;
              strip.setSidechain(bus, { ...cur, attack: v });
            },
          })}
          ${scKnob({
            id: `${laneId}.fx.sc.rel`, label: 'REL', title: SC_TIPS.rel,
            min: 0.005, max: 1, step: 0.005,
            value: current()?.release ?? 0.25, defaultValue: 0.25, color: SC_COLOR, format: fmtMs,
            onChange: (v) => {
              const cur = current(); if (!cur) return;
              strip.setSidechain(bus, { ...cur, release: v });
            },
          })}
        </div>
      </div>
      ${help.popover}
    </div>
  `;
}

export function mountLaneFxPanel(opts: LaneFxPanelOpts): void {
  // Stop the outgoing panel's frame loop BEFORE building the new one, wherever it
  // was mounted — a lane switch can move this panel to another page's slot.
  disposeLaneFxPanel();
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
