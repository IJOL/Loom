// src/session/lane-insert-ui.ts
import { html, nothing, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { styleMap } from 'lit-html/directives/style-map.js';
import { listPlugins, createInstance } from '../plugins/registry';
import { type InsertSlot, newInsertId } from './insert-slot';
import type { InsertChain, ChainSlot } from '../core/insert-chain';
import { createKnob, type KnobHandle } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import { buildFxVis, hasFxVis, VIS_W, VIS_H } from '../core/fx-vis';
import { insertParamId } from '../automation/automation-targets';
import { mountPanel, type PanelHandle } from '../core/lit-panel';
import { renderElement } from '../core/lit-fragment';
import type { PluginFactory } from '../plugins/types';

type FxFactory = Extract<PluginFactory, { kind: 'fx' }>;

export interface LaneInsertUIDeps {
  ctx: AudioContext;
  container: HTMLElement;
  chain: InsertChain;
  slots: InsertSlot[];
  onChange: () => void;
  /** The rack this chain belongs to: a lane id, or `fx.master` / `fx.send.<id>`
   *  for the global racks. Continuous-param knobs then get their canonical
   *  automation id (see `insertParamId`) and are registered so the live handle
   *  can be found. The id depends only on the scope, never on the panel being
   *  mounted, so it matches what `listAutomationTargets` derives from the
   *  session — the picker offers the same id either way. */
  registerKnob?: (k: KnobHandle) => void;
  automationScopeId?: string;
  /** Fired when the SET of destinations changes (an insert added or removed),
   *  not when a value changes. Drives DestinationRegistry.invalidate(). */
  onDestinationsChanged?: () => void;
}

/** Render the lane's insert chain as a horizontal bar of compact units — one
 *  unit per effect (header: colour dot + name + any discrete selectors; a knob
 *  row; a control cluster with bypass + remove), reusing the synths' compact knob
 *  rows. The bar wraps to a second line when it runs out of width.
 *
 *  The panel is a lit-html template mounted via mountPanel; knobs, the vis
 *  thumbnail and the discrete selects are built once per slot in the panel's
 *  ControlCache (keyed by slot id), so a bypass toggle or an add/remove repaints
 *  around them instead of rebuilding every widget. */
export function buildLaneInsertUI(deps: LaneInsertUIDeps): void {
  // Per-mount UI state: an external rebuild (a fresh call) drops an open picker,
  // matching the old full-rebuild behaviour.
  let pickerOpen = false;
  const handle = mountPanel({
    container: deps.container,
    className: 'insert-rack',
    deps,
    template: (h) => rackTemplate(h, () => pickerOpen, (open) => { pickerOpen = open; }),
  });
  // The host must not introduce a layout box: the master rack (#fx-filters) is
  // a flex column whose gap used to separate the bar / add button / picker
  // directly, so they must keep participating in the container's layout.
  handle.host.style.display = 'contents';
}

type Rack = PanelHandle<LaneInsertUIDeps>;

function rackTemplate(h: Rack, isPickerOpen: () => boolean, setPicker: (open: boolean) => void): TemplateResult {
  const { chain, slots } = h.deps;
  return html`
    <div class="insert-bar">
      ${repeat(
        chain.list(),
        (cs) => cs.id,
        (cs, idx) => unitTemplate(h, cs, idx),
      )}
    </div>
    <button class="insert-add" @click=${() => {
      if (isPickerOpen()) return;   // one picker at a time
      setPicker(true);
      h.rerender();
    }}>+ Add insert</button>
    ${isPickerOpen() ? pickerTemplate(h, setPicker) : nothing}
  `;
}

function unitTemplate(h: Rack, cs: ChainSlot, idx: number): TemplateResult | typeof nothing {
  const { chain, slots, onChange } = h.deps;
  // By ID, never by position. Removing a slot renumbers every later one, so
  // position must not be trusted regardless of what the slot holds.
  const slot = slots.find((s) => s.id === cs.id);
  if (!slot) return nothing;
  const factory = listPlugins('fx').find((p) => p.manifest.id === slot.pluginId);
  if (!factory) return missingUnitTemplate(h, cs, idx, slot);

  // Every insert declares its own colour on its manifest (Task 7); the rack
  // knows nothing about any particular id. `?? 'currentColor'` covers the
  // TYPE only — a `factory` here is always fx-kind and every fx module sets
  // `color` — the registry test (lane-insert-ui.test.ts) is what guarantees
  // an insert never actually falls through to this fallback.
  const color = factory.manifest.color ?? 'currentColor';
  const w = h.cache.get<UnitWidgets>(`unit:${slot.id}`, () => buildUnitWidgets(h.deps, cs, slot, factory, color));

  return html`
    <div class="insert-unit" style=${styleMap({ '--fx-color': color })}>
      <div class="insert-unit-head"><span class="insert-dot"></span><b class="insert-name">${factory.manifest.name}</b>${w.discretes}</div>
      ${w.visEl ?? nothing}
      <div class="knob-row">${w.knobs.map((k) => k.el)}</div>
      <div class="insert-unit-ctl">
        <button class=${slot.bypass ? 'insert-btn bypassed' : 'insert-btn'} @click=${() => {
          slot.bypass = !slot.bypass;
          chain.setBypass(idx, slot.bypass);
          onChange();
          h.rerender();
        }}>${slot.bypass ? 'BYP' : 'ON'}</button>
        <button class="insert-btn insert-rm" title="Remove insert" @click=${() => {
          chain.remove(idx);
          const at = slots.findIndex((s) => s.id === cs.id);
          if (at >= 0) slots.splice(at, 1);
          onChange();
          h.deps.onDestinationsChanged?.();
          h.rerender();
        }}>×</button>
      </div>
    </div>
  `;
}

/** The unit for a slot whose plugin is not installed. Mirrors the lane header's
 *  ⚠ for a missing engine — same contract, same words, so a user meets one idea
 *  and not two. No knobs to draw and nothing to bypass; the × is there because
 *  removing it must stay the user's decision, not ours. */
function missingUnitTemplate(
  h: Rack, cs: ChainSlot, idx: number, slot: InsertSlot,
): TemplateResult {
  const { chain, slots, onChange } = h.deps;
  return html`
    <div class="insert-unit insert-unit-missing"
         title=${`Insert not installed: ${slot.pluginId}. This slot keeps its settings — install the plugin and reload.`}>
      <div class="insert-unit-head"><span class="insert-dot"></span><b class="insert-name">⚠ ${slot.pluginId}</b></div>
      <div class="insert-unit-ctl">
        <span class="insert-missing-note">not installed</span>
        <button class="insert-btn insert-rm" title="Remove insert" @click=${() => {
          chain.remove(idx);
          const at = slots.findIndex((s) => s.id === cs.id);
          if (at >= 0) slots.splice(at, 1);
          onChange();
          h.deps.onDestinationsChanged?.();
          h.rerender();
        }}>×</button>
      </div>
    </div>
  `;
}

interface UnitWidgets {
  /** Thumbnail SVG, absent for effects with no still-frame vis. */
  visEl?: Element;
  knobs: KnobHandle[];
  /** A native <select> (>4 options / forceSelect) or a `.radio-strip` div
   *  (≤4) — whichever createSelectControl picks; see engine-param-grid.ts's
   *  header for the rule this rack now also obeys (Task 8b). */
  discretes: HTMLElement[];
}

/** Create-once widgets for one insert unit. Knobs own their DOM + drag state and
 *  the vis redraw is imperative (a knob drag repaints only the two <path>s), so
 *  none of this can live in the template body. */
function buildUnitWidgets(
  deps: LaneInsertUIDeps,
  cs: ChainSlot,
  slot: InsertSlot,
  factory: FxFactory,
  color: string,
): UnitWidgets {
  // ── Thumbnail: what the current knob positions add up to ──────────────────
  // A delay at feedback 0.8 should LOOK different from one at 0.2 before you
  // play a note. Effects whose point is movement (chorus/flanger/phaser) get
  // no picture — a still frame of them says nothing.
  let redrawVis = (): void => {};
  let visEl: Element | undefined;
  if (hasFxVis(factory.manifest.id)) {
    visEl = renderElement(html`<svg class="insert-vis" viewBox="0 0 ${VIS_W} ${VIS_H}" preserveAspectRatio="none"><path class="insert-vis-area"></path><path class="insert-vis-line"></path></svg>`);
    const area = visEl.querySelector('.insert-vis-area')!;
    const line = visEl.querySelector('.insert-vis-line')!;
    redrawVis = () => {
      const vis = buildFxVis(factory.manifest.id, (id) => cs.fx.getBaseValue(id));
      if (!vis) return;
      area.setAttribute('d', vis.area ?? '');
      line.setAttribute('d', vis.line);
    };
    redrawVis();
  }

  const knobs: KnobHandle[] = [];
  const discretes: HTMLElement[] = [];
  for (const spec of factory.manifest.params) {
    if (spec.kind === 'continuous') {
      const knobId = deps.automationScopeId
        ? insertParamId(deps.automationScopeId, slot.id, spec.id)
        : undefined;
      const handle = createKnob({
        id: knobId,
        label: spec.label,
        min: spec.min, max: spec.max,
        value: cs.fx.getBaseValue(spec.id),
        color,
        onChange: (v) => { cs.fx.setBaseValue(spec.id, v); slot.params[spec.id] = v; redrawVis(); deps.onChange(); },
      });
      knobs.push(handle);
      if (deps.automationScopeId && deps.registerKnob) deps.registerKnob(handle);
    } else if (spec.kind === 'discrete' && spec.options) {
      // Discrete params (filter type, delay sync) sit in the header, drawn
      // through the SAME select-control builder every other surface uses
      // (Task 8b) — this rack no longer hand-rolls its own <select>. ≤4
      // options draw a vertical strip, more draw a native <select>; either
      // way the widget gets the `insert-sel` class for header spacing (its
      // full themed look is `select`-only — see _fx.scss).
      const options = spec.options;
      const idx = Math.max(0, Math.min(options.length - 1, Math.round(cs.fx.getBaseValue(spec.id))));
      // Same id scheme as the continuous knobs above (insertParamId), for
      // consistency — but note the `handle` this returns is discarded below
      // (only `el` is kept): discrete FX-insert params are not yet wired into
      // automation, unlike their continuous siblings three lines up.
      const { el } = createSelectControl({
        id: deps.automationScopeId
          ? insertParamId(deps.automationScopeId, slot.id, spec.id)
          : `${slot.id}.${spec.id}`,
        options,
        initialValue: options[idx]?.value ?? options[0].value,
        compact: true,
        onChange: (v) => {
          const i = options.findIndex((o) => o.value === v);
          const clamped = Math.max(0, i);
          cs.fx.setBaseValue(spec.id, clamped);
          slot.params[spec.id] = clamped;
          redrawVis();
          deps.onChange();
        },
      });
      el.classList.add('insert-sel');
      el.title = spec.label;
      discretes.push(el);
    }
  }
  return { visEl, knobs, discretes };
}

function pickerTemplate(h: Rack, setPicker: (open: boolean) => void): TemplateResult {
  const close = () => { setPicker(false); h.rerender(); };
  const onPick = (e: Event) => {
    const pluginId = (e.target as HTMLSelectElement).value;
    if (!pluginId) { close(); return; }
    const inst = createInstance('fx', pluginId, h.deps.ctx);
    if (!inst) { close(); return; }
    const factory = listPlugins('fx').find((p) => p.manifest.id === pluginId)!;
    const params: Record<string, number> = {};
    for (const s of factory.manifest.params) params[s.id] = inst.getBaseValue(s.id);
    const slot: InsertSlot = { id: newInsertId(), pluginId, params, bypass: false };
    h.deps.slots.push(slot);
    h.deps.chain.insert(inst, slot.id);
    h.deps.onChange();
    h.deps.onDestinationsChanged?.();
    close();
  };
  return html`<select class="insert-add-picker" @change=${onPick}><option value="">—</option>${listPlugins('fx').map((p) => html`<option value=${p.manifest.id}>${p.manifest.name}</option>`)}</select>`;
}
