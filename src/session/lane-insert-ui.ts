// src/session/lane-insert-ui.ts
import { listPlugins, createInstance } from '../plugins/registry';
import { applyInsertSlot, type InsertSlot } from './insert-slot';
import type { InsertChain } from '../plugins/fx/insert-chain';
import { createKnob } from '../core/knob';

const SEND_ONLY_IN_PHASE_1 = new Set<string>();  // reverb/delay live in FxBus; pickable from inserts is fine but skipped in phase 1

export interface LaneInsertUIDeps {
  ctx: AudioContext;
  container: HTMLElement;
  chain: InsertChain;
  slots: InsertSlot[];
  onChange: () => void;
}

export function buildLaneInsertUI(deps: LaneInsertUIDeps): void {
  const { ctx, container, chain, slots, onChange } = deps;
  container.replaceChildren();

  chain.list().forEach((cs, idx) => {
    const slot = slots[idx];
    if (!slot) return;
    const row = document.createElement('div');
    row.className = 'insert-slot';

    const factory = listPlugins('fx').find((p) => p.manifest.id === slot.pluginId);
    if (factory) {
      const label = document.createElement('span');
      label.textContent = factory.manifest.name;
      row.appendChild(label);

      for (const spec of factory.manifest.params) {
        if (spec.kind !== 'continuous') continue;
        // createKnob takes (opts: KnobOpts): KnobHandle — no parent/get/set fields.
        // Adapt: value = get(), onChange = set(v), append handle.el to row manually.
        const handle = createKnob({
          label: spec.label,
          min: spec.min, max: spec.max,
          value: cs.fx.getBaseValue(spec.id),
          onChange: (v) => { cs.fx.setBaseValue(spec.id, v); slot.params[spec.id] = v; onChange(); },
        });
        row.appendChild(handle.el);
      }
    }

    const bypass = document.createElement('button');
    bypass.textContent = slot.bypass ? 'BYP' : 'ON';
    bypass.onclick = () => {
      slot.bypass = !slot.bypass;
      chain.setBypass(idx, slot.bypass);
      onChange();
      buildLaneInsertUI(deps);
    };
    row.appendChild(bypass);

    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.onclick = () => {
      chain.remove(idx);
      slots.splice(idx, 1);
      onChange();
      buildLaneInsertUI(deps);
    };
    row.appendChild(rm);

    container.appendChild(row);
  });

  const add = document.createElement('button');
  add.textContent = '+ Add insert';
  add.onclick = () => {
    const picker = document.createElement('select');
    picker.appendChild(new Option('—', ''));
    for (const p of listPlugins('fx')) {
      if (SEND_ONLY_IN_PHASE_1.has(p.manifest.id)) continue;
      picker.appendChild(new Option(p.manifest.name, p.manifest.id));
    }
    picker.onchange = () => {
      const pluginId = picker.value;
      if (!pluginId) return;
      const inst = createInstance('fx', pluginId, ctx);
      if (!inst) return;
      const factory = listPlugins('fx').find((p) => p.manifest.id === pluginId)!;
      const params: Record<string, number> = {};
      for (const s of factory.manifest.params) params[s.id] = inst.getBaseValue(s.id);
      const slot: InsertSlot = { pluginId, params, bypass: false };
      slots.push(slot);
      chain.insert(inst);
      onChange();
      buildLaneInsertUI(deps);
    };
    container.appendChild(picker);
  };
  container.appendChild(add);
}
