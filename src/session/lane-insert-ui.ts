// src/session/lane-insert-ui.ts
import { listPlugins, createInstance } from '../plugins/registry';
import { type InsertSlot, newInsertId } from './insert-slot';
import type { InsertChain } from '../plugins/fx/insert-chain';
import { createKnob, type KnobHandle } from '../core/knob';
import { buildFxVis, hasFxVis, VIS_W, VIS_H } from '../core/fx-vis';
import { insertParamId } from '../automation/automation-targets';

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

// Per-effect accent colour (keyed by plugin id). Each insert is tinted with it —
// a coloured dot in the header + the knob rings — so a chain reads at a glance.
const FX_COLORS: Record<string, string> = {
  multifilter: '#ffa726', // amber
  delay:       '#5aa9e6', // blue
  distortion:  '#e6794a', // orange
  reverb:      '#9b6dff', // violet
  compressor:  '#1abc9c', // teal
  limiter:     '#e05a8a', // pink
};
const FX_FALLBACK = '#ffa726';

/** Render the lane's insert chain as a horizontal bar of compact units — one
 *  unit per effect (header: colour dot + name + any discrete selectors; a knob
 *  row; a control cluster with bypass + remove), reusing the synths' compact knob
 *  rows. The bar wraps to a second line when it runs out of width. */
export function buildLaneInsertUI(deps: LaneInsertUIDeps): void {
  const { ctx, container, chain, slots, onChange } = deps;
  const { registerKnob, automationScopeId, onDestinationsChanged } = deps;
  container.replaceChildren();

  const bar = document.createElement('div');
  bar.className = 'insert-bar';
  container.appendChild(bar);

  chain.list().forEach((cs, idx) => {
    const slot = slots[idx];
    if (!slot) return;
    const factory = listPlugins('fx').find((p) => p.manifest.id === slot.pluginId);
    if (!factory) return;

    const color = FX_COLORS[slot.pluginId] ?? FX_FALLBACK;

    const unit = document.createElement('div');
    unit.className = 'insert-unit';
    unit.style.setProperty('--fx-color', color);

    // ── Header: colour dot + effect name + discrete selectors (type / sync) ──
    const head = document.createElement('div');
    head.className = 'insert-unit-head';
    const dot = document.createElement('span');
    dot.className = 'insert-dot';
    head.appendChild(dot);
    const name = document.createElement('b');
    name.className = 'insert-name';
    name.textContent = factory.manifest.name;
    head.appendChild(name);
    unit.appendChild(head);

    // ── Thumbnail: what the current knob positions add up to ──────────────────
    // A delay at feedback 0.8 should LOOK different from one at 0.2 before you
    // play a note. Effects whose point is movement (chorus/flanger/phaser) get
    // no picture — a still frame of them says nothing.
    const NS = 'http://www.w3.org/2000/svg';
    let redrawVis = (): void => {};
    if (hasFxVis(factory.manifest.id)) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'insert-vis');
      svg.setAttribute('viewBox', `0 0 ${VIS_W} ${VIS_H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const area = document.createElementNS(NS, 'path');
      area.setAttribute('class', 'insert-vis-area');
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('class', 'insert-vis-line');
      svg.appendChild(area);
      svg.appendChild(line);
      redrawVis = () => {
        const vis = buildFxVis(factory.manifest.id, (id) => cs.fx.getBaseValue(id));
        if (!vis) return;
        area.setAttribute('d', vis.area ?? '');
        line.setAttribute('d', vis.line);
      };
      redrawVis();
      unit.appendChild(svg);
    }

    // ── Knob row: one knob per continuous param (compact, like the synth rows) ──
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';

    for (const spec of factory.manifest.params) {
      if (spec.kind === 'continuous') {
        const knobId = automationScopeId
          ? insertParamId(automationScopeId, slot.id, spec.id)
          : undefined;
        const handle = createKnob({
          id: knobId,
          label: spec.label,
          min: spec.min, max: spec.max,
          value: cs.fx.getBaseValue(spec.id),
          color,
          onChange: (v) => { cs.fx.setBaseValue(spec.id, v); slot.params[spec.id] = v; redrawVis(); onChange(); },
        });
        knobRow.appendChild(handle.el);
        if (automationScopeId && registerKnob) registerKnob(handle);
      } else if (spec.kind === 'discrete' && spec.options) {
        // Discrete params (filter type, delay sync) sit in the header as a mini select.
        const sel = document.createElement('select');
        sel.className = 'insert-sel';
        sel.title = spec.label;
        spec.options.forEach((opt, i) => sel.appendChild(new Option(opt.label, String(i))));
        sel.selectedIndex = Math.round(cs.fx.getBaseValue(spec.id));
        sel.onchange = () => {
          const i = sel.selectedIndex;
          cs.fx.setBaseValue(spec.id, i);
          slot.params[spec.id] = i;
          redrawVis();
          onChange();
        };
        head.appendChild(sel);
      }
    }
    unit.appendChild(knobRow);

    // ── Control cluster: bypass toggle + remove ──
    const ctl = document.createElement('div');
    ctl.className = 'insert-unit-ctl';

    const bypass = document.createElement('button');
    bypass.className = 'insert-btn';
    bypass.textContent = slot.bypass ? 'BYP' : 'ON';
    bypass.classList.toggle('bypassed', slot.bypass);
    bypass.onclick = () => {
      slot.bypass = !slot.bypass;
      chain.setBypass(idx, slot.bypass);
      onChange();
      buildLaneInsertUI(deps);
    };
    ctl.appendChild(bypass);

    const rm = document.createElement('button');
    rm.className = 'insert-btn insert-rm';
    rm.textContent = '×';
    rm.title = 'Remove insert';
    rm.onclick = () => {
      chain.remove(idx);
      slots.splice(idx, 1);
      onChange();
      onDestinationsChanged?.();
      buildLaneInsertUI(deps);
    };
    ctl.appendChild(rm);

    unit.appendChild(ctl);
    bar.appendChild(unit);
  });

  // ── "+ Add insert" (outside the bar) ──
  const add = document.createElement('button');
  add.className = 'insert-add';
  add.textContent = '+ Add insert';
  add.onclick = () => {
    if (container.querySelector('.insert-add-picker')) return;   // one picker at a time
    const picker = document.createElement('select');
    picker.className = 'insert-add-picker';
    picker.appendChild(new Option('—', ''));
    for (const p of listPlugins('fx')) {
      picker.appendChild(new Option(p.manifest.name, p.manifest.id));
    }
    picker.onchange = () => {
      const pluginId = picker.value;
      if (!pluginId) { picker.remove(); return; }
      const inst = createInstance('fx', pluginId, ctx);
      if (!inst) { picker.remove(); return; }
      const factory = listPlugins('fx').find((p) => p.manifest.id === pluginId)!;
      const params: Record<string, number> = {};
      for (const s of factory.manifest.params) params[s.id] = inst.getBaseValue(s.id);
      const slot: InsertSlot = { id: newInsertId(), pluginId, params, bypass: false };
      slots.push(slot);
      chain.insert(inst, slot.id);
      onChange();
      onDestinationsChanged?.();
      buildLaneInsertUI(deps);
    };
    add.insertAdjacentElement('afterend', picker);
  };
  container.appendChild(add);
}
