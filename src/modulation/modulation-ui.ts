// src/modulation/modulation-ui.ts
// Renders the modulators panel inside an engine's buildParamUI. Each
// engine instance has one ModulationHost; this UI mutates host state
// directly, then triggers an onChange callback so the engine can rebuild
// voices (or notify the registry).

import type { KnobHandle } from '../core/knob';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import { SYNC_RATIO_MAP } from './rate-sync';
import type { ModulationHost, ModulatorState, Waveform } from './types';

export interface ModulationUIDeps {
  engineId: string;
  laneId: string;                         // for param-id prefix matching destination dropdown
  /** Additional id-prefixes the destination dropdown should match (e.g. the
   *  engine-specific knob namespace: 'tb303', 'poly', 'wt-', 'fm.', 'ks-',
   *  'mix.drumBus'). */
  extraPrefixes?: string[];
  host: ModulationHost;
  registry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  onChange: () => void;                   // engine re-renders or rebuilds voice
}

export function renderModulatorsPanel(container: HTMLElement, deps: ModulationUIDeps): void {
  const box = document.createElement('div');
  box.className = 'mod-panel';

  const title = document.createElement('div');
  title.className = 'mod-panel-title';
  title.textContent = 'MODULATORS';
  box.appendChild(title);

  const header = document.createElement('div');
  header.className = 'mod-panel-header';
  header.appendChild(mkAddButton('+ LFO',  () => { deps.host.addModulator('lfo');  deps.onChange(); }));
  header.appendChild(mkAddButton('+ ADSR', () => { deps.host.addModulator('adsr'); deps.onChange(); }));
  box.appendChild(header);

  for (const mod of deps.host.modulators) {
    box.appendChild(renderModCard(mod, deps));
  }
  container.appendChild(box);
}

function mkAddButton(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.className = 'rnd';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderModCard(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const card = document.createElement('div');
  card.className = `mod-card mod-${mod.kind}`;

  const head = document.createElement('div');
  head.className = 'mod-card-header';
  const title = document.createElement('div');
  title.className = 'mod-card-title';
  title.textContent = mod.id.toUpperCase();
  head.appendChild(title);

  const enableBtn = document.createElement('button');
  const refreshEnableUI = () => {
    enableBtn.className = 'rnd' + (mod.enabled ? ' primary' : '');
    enableBtn.textContent = mod.enabled ? 'ON' : 'OFF';
  };
  refreshEnableUI();
  enableBtn.addEventListener('click', () => {
    mod.enabled = !mod.enabled;
    refreshEnableUI();
  });
  head.appendChild(enableBtn);

  const rmBtn = document.createElement('button');
  rmBtn.className = 'rnd';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => { deps.host.removeModulator(mod.id); deps.onChange(); });
  head.appendChild(rmBtn);
  card.appendChild(head);

  card.appendChild(mod.kind === 'lfo' ? renderLfoConfig(mod, deps) : renderAdsrConfig(mod, deps));
  card.appendChild(renderRoutingList(mod, deps));
  return card;
}

function renderLfoConfig(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mod-card-config';

  const wave = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.waveform`,
    label: 'WAVE',
    options: [
      { value: 'sine',     label: 'Sine' },
      { value: 'triangle', label: 'Tri'  },
      { value: 'square',   label: 'Sqr'  },
      { value: 'saw',      label: 'Saw'  },
    ],
    initialValue: mod.waveform ?? 'sine',
    onChange: (v) => { mod.waveform = v as Waveform; },
  });
  deps.registerKnob(wave.handle);
  row.appendChild(wave.el);

  const rate = createKnob({
    id: `${deps.laneId}.mod.${mod.id}.rate`,
    label: 'RATE',
    min: 0.01, max: 40, step: 0.01,
    value: mod.rateHz ?? 4,
    defaultValue: 4,
    onChange: (v) => { mod.rateHz = v; },
    format: (v) => v < 1 ? `${v.toFixed(2)}Hz` : `${v.toFixed(1)}Hz`,
  });
  deps.registerKnob(rate);
  row.appendChild(rate.el);

  const ratioOpts = Object.keys(SYNC_RATIO_MAP).map((k) => ({ value: k, label: k }));
  const ratio = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.syncRatio`,
    label: 'RATIO',
    options: ratioOpts,
    initialValue: mod.syncRatio ?? '1/4',
    onChange: (v) => { mod.syncRatio = v; },
  });
  deps.registerKnob(ratio.handle);
  row.appendChild(ratio.el);

  const syncBtn = document.createElement('button');
  const refreshSyncUI = () => {
    syncBtn.className = 'rnd' + (mod.syncToBpm ? ' primary' : '');
    syncBtn.textContent = mod.syncToBpm ? 'SYNC' : 'FREE';
    rate.el.style.display      = mod.syncToBpm ? 'none' : '';
    ratio.el.style.display     = mod.syncToBpm ? '' : 'none';
  };
  refreshSyncUI();
  syncBtn.addEventListener('click', () => {
    mod.syncToBpm = !mod.syncToBpm;
    refreshSyncUI();
  });
  row.appendChild(syncBtn);

  const bipolar = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.bipolar`,
    label: 'POLARITY',
    options: [
      { value: 'uni', label: '0..1' },
      { value: 'bi',  label: '-1..+1' },
    ],
    initialValue: (mod.bipolar !== false) ? 'bi' : 'uni',
    onChange: (v) => { mod.bipolar = v === 'bi'; },
  });
  deps.registerKnob(bipolar.handle);
  row.appendChild(bipolar.el);

  return row;
}

function renderAdsrConfig(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mod-card-config';

  const mkAdsrKnob = (
    field: 'attackSec' | 'decaySec' | 'sustain' | 'releaseSec',
    label: string, min: number, max: number, def: number,
    fmt: (v: number) => string,
  ) => {
    const k = createKnob({
      id: `${deps.laneId}.mod.${mod.id}.${field}`,
      label, min, max, step: 0.001,
      value: (mod[field] as number | undefined) ?? def,
      defaultValue: def,
      onChange: (v) => { (mod as unknown as Record<string, unknown>)[field] = v; },
      format: fmt,
    });
    deps.registerKnob(k);
    row.appendChild(k.el);
  };

  const fmtTime = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
  mkAdsrKnob('attackSec',  'A', 0.001, 2,    0.01, fmtTime);
  mkAdsrKnob('decaySec',   'D', 0.001, 4,    0.3,  fmtTime);
  mkAdsrKnob('sustain',    'S', 0,     1,    0.7,  (v) => `${Math.round(v * 100)}%`);
  mkAdsrKnob('releaseSec', 'R', 0.001, 8,    0.3,  fmtTime);

  return row;
}

function renderRoutingList(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const list = document.createElement('div');
  list.className = 'mod-card-routing';

  for (const conn of mod.connections) {
    list.appendChild(renderConnectionRow(mod, conn, deps));
  }

  const adder = document.createElement('div');
  adder.className = 'mod-conn-adder';
  const destSel = document.createElement('select');
  destSel.className = 'mod-dest-select';
  const used = new Set(mod.connections.map((c) => c.paramId));
  const prefixes = [deps.laneId, ...(deps.extraPrefixes ?? [])];
  for (const id of destinationIds(deps.registry, prefixes)) {
    if (used.has(id)) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    destSel.appendChild(opt);
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'rnd primary';
  addBtn.textContent = '+ Destination';
  addBtn.addEventListener('click', () => {
    const paramId = destSel.value;
    if (!paramId) return;
    const cid = `c-${Date.now().toString(36)}`;
    deps.host.setConnection(mod.id, { id: cid, paramId, depth: 0.5 });
    deps.onChange();
  });
  adder.appendChild(destSel);
  adder.appendChild(addBtn);
  list.appendChild(adder);

  return list;
}

function renderConnectionRow(mod: ModulatorState, conn: import('./types').ModulationConnection, deps: ModulationUIDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mod-conn-row';

  const label = document.createElement('span');
  label.className = 'mod-conn-target';
  label.textContent = conn.paramId;
  row.appendChild(label);

  const depthKnob = createKnob({
    id: `${deps.laneId}.mod.${mod.id}.conn.${conn.id}.depth`,
    label: 'DEPTH',
    min: -1, max: 1, step: 0.001,
    value: conn.depth, defaultValue: 0,
    onChange: (v) => {
      deps.host.setConnection(mod.id, { ...conn, depth: v });
    },
    format: (v) => v.toFixed(2),
  });
  deps.registerKnob(depthKnob);
  row.appendChild(depthKnob.el);

  const rmBtn = document.createElement('button');
  rmBtn.className = 'rnd';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => { deps.host.removeConnection(mod.id, conn.id); deps.onChange(); });
  row.appendChild(rmBtn);

  return row;
}

function destinationIds(registry: Map<string, KnobHandle>, prefixes: string[]): string[] {
  return [...registry.keys()].filter((id) => {
    if (id.includes('.mod.')) return false;
    return prefixes.some((p) => id.startsWith(`${p}.`));
  });
}
