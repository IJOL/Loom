// src/modulation/modulation-ui.ts
// Renders the modulators panel inside an engine's buildParamUI. Each
// engine instance has one ModulationHost; this UI mutates host state
// directly, then triggers an onChange callback so the engine can rebuild
// voices (or notify the registry).

import type { KnobHandle } from '../core/knob';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import { lfoFreeRatePosToHz, lfoFreeRateHzToPos } from './rate-sync';
import { formatParamIdForDisplay } from '../core/lane-display';
import type { ModulationHost, ModulatorState, Waveform } from './types';
import type { SessionState } from '../session/session';
import { attachKnobUndo, withUndo, type HistoryDeps } from '../save/history-wiring';
import type { DestinationRegistry } from '../automation/destination-registry';
import { groupTargetsByLane } from '../automation/automation-targets';

export interface ModulationUIDeps {
  engineId: string;
  laneId: string;                         // scopes the destination dropdown to this lane (+master) and namespaces this modulator's own knob ids
  host: ModulationHost;
  registry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  onChange: () => void;                   // engine re-renders or rebuilds voice
  /** Push the CURRENT modulator set to the live engine WITHOUT rebuilding the
   *  panel. Called after every value tweak (depth/on-off/rate/wave/…) so the
   *  change is actually heard — the worklet only re-reads modulators when this
   *  (or onChange) fires. Without it, editing DEPTH or toggling ON/OFF mutated
   *  state + saved it but never reached the worklet, so nothing changed. */
  onLiveEdit?: () => void;
  /** Resolves a session laneId (`bass`, `main`, `drums`, `poly1`…) to its
   *  user-facing display name (`TB-303 1`, `Subtractive 1`…) so the dropdown
   *  and connection labels can show the same name the session uses
   *  everywhere else. Optional — if omitted, raw ids are shown. */
  lookupLaneDisplayName?: (laneId: string) => string | undefined;
  /** Phase C: when present, every modulator mutation mirrors into
   *  `sessionState.lanes[laneId].engineState.modulators`. */
  sessionState?: SessionState;
  /** Optional undo history deps. When present, every modulator knob drag/wheel/
   *  dblclick is bracketed as a single undo entry. */
  historyDeps?: HistoryDeps;
  /** Task 6: the one destination catalogue. When present, the destination
   *  dropdown is built from `destinations.list()` (grouped by lane) instead of
   *  scraping the knob registry + live insert chains, and the panel subscribes
   *  to structural changes so it refreshes without waiting for the dropdown to
   *  be opened. */
  destinations?: DestinationRegistry;
}

function sync(deps: ModulationUIDeps): void {
  // The engine's ModulationHost is the single source of truth for modulators —
  // deps.host, which the controls just mutated. It no longer needs mirroring into
  // lane.engineState: save reads the live host (collectEngineState), and duplicate
  // -lane seeds the clone from the live host too. Just push the edit to the audio.
  // Every control calls sync() after mutating modulator state, so pushing here
  // makes ALL of them (depth, on/off, rate, wave, sync, polarity, scope…) take
  // effect, not just add/remove which call onChange.
  deps.onLiveEdit?.();
}

// A panel is rebuilt by wiping its host and calling this again — 48 call
// sites across the codebase do `container.innerHTML = ''` before a rebuild.
// That destroys DOM but NOT a subscription a previous call registered. Bind
// each container's destinations subscription to an AbortController keyed on
// that container, and abort the previous one at the top of every call, so a
// rebuild (whether triggered by the caller or by the subscription itself)
// always ends with exactly ONE live subscription, never a stack of them.
// Mirrors the pattern at session-inspector.ts:258 / performance-ui.ts:295.
const panelAborts = new WeakMap<HTMLElement, AbortController>();

export function renderModulatorsPanel(container: HTMLElement, deps: ModulationUIDeps): void {
  panelAborts.get(container)?.abort();
  const ac = new AbortController();
  panelAborts.set(container, ac);

  const box = document.createElement('div');
  box.className = 'mod-panel';

  const title = document.createElement('div');
  title.className = 'mod-panel-title';
  title.textContent = 'MODULATORS';
  box.appendChild(title);

  const header = document.createElement('div');
  header.className = 'mod-panel-header';
  header.appendChild(mkAddButton('+ LFO',  () => {
    const run = () => { deps.host.addModulator('lfo');  sync(deps); deps.onChange(); };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  }));
  header.appendChild(mkAddButton('+ ADSR', () => {
    const run = () => { deps.host.addModulator('adsr'); sync(deps); deps.onChange(); };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  }));
  box.appendChild(header);

  for (const mod of deps.host.modulators) {
    box.appendChild(renderModCard(mod, deps));
  }

  // Replace only the `.mod-panel` element THIS function owns. `container` is
  // also the host for sibling panels appended by the caller (note-FX, lane
  // inserts) — session-host-lane-editor.ts appends them to the same element
  // AFTER buildParamUI (which renders this panel) returns. Wiping the whole
  // container here would delete those siblings on every registry-driven
  // rebuild.
  const existing = container.querySelector<HTMLElement>('.mod-panel');
  if (existing) existing.replaceWith(box); else container.appendChild(box);

  // Subscribe AFTER the DOM is in place. A notification calls this function
  // again for the SAME container, which aborts `ac` (dropping this listener)
  // before registering its own — so the set of live listeners never grows
  // past one per container, and a rebuild triggered by invalidate() cannot
  // re-enter: invalidate() iterates a snapshot of listeners taken before
  // calling any of them, so a listener that resubscribes during the call
  // isn't visited again in the same pass.
  const off = deps.destinations?.subscribe(() => renderModulatorsPanel(container, deps));
  if (off) ac.signal.addEventListener('abort', off, { once: true });
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

  // Single horizontal row: title • config knobs • on/× buttons.
  const row = document.createElement('div');
  row.className = 'mod-card-row';

  const title = document.createElement('div');
  title.className = 'mod-card-title';
  title.textContent = mod.id.toUpperCase();
  row.appendChild(title);

  row.appendChild(mod.kind === 'lfo' ? renderLfoConfig(mod, deps) : renderAdsrConfig(mod, deps));

  const enableBtn = document.createElement('button');
  const refreshEnableUI = () => {
    enableBtn.className = 'rnd' + (mod.enabled ? ' primary' : '');
    enableBtn.textContent = mod.enabled ? 'ON' : 'OFF';
  };
  refreshEnableUI();
  enableBtn.addEventListener('click', () => {
    const run = () => { mod.enabled = !mod.enabled; sync(deps); };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
    refreshEnableUI();
  });
  row.appendChild(enableBtn);

  const rmBtn = document.createElement('button');
  rmBtn.className = 'rnd';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => {
    const run = () => { deps.host.removeModulator(mod.id); sync(deps); deps.onChange(); };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  });
  row.appendChild(rmBtn);

  card.appendChild(row);
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
    onChange: (v) => {
      const run = () => { mod.waveform = v as Waveform; sync(deps); };
      if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
    },
  });
  deps.registerKnob(wave.handle);
  row.appendChild(wave.el);

  // FREE rate: a 0..1 position knob with a piecewise scale (slow range gets
  // the first half — see lfoFreeRatePosToHz). Stored as Hz in mod.rateHz; the
  // knob maps position↔Hz and displays the rate in bpm (LFO cycles/min).
  const rate = createKnob({
    id: `${deps.laneId}.mod.${mod.id}.rate`,
    label: 'RATE',
    min: 0, max: 1, step: 0.001,
    value: lfoFreeRateHzToPos(mod.rateHz ?? 4),
    defaultValue: lfoFreeRateHzToPos(4),
    onChange: (pos) => { mod.rateHz = lfoFreeRatePosToHz(pos); sync(deps); },
    format: (pos) => {
      const b = lfoFreeRatePosToHz(pos) * 60;
      // bpm with adaptive precision so ultra-slow rates aren't shown as "0 bpm".
      return b < 1 ? `${b.toFixed(2)} bpm` : b < 10 ? `${b.toFixed(1)} bpm` : `${Math.round(b)} bpm`;
    },
    ...(deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {}),
  });
  deps.registerKnob(rate);
  row.appendChild(rate.el);

  // SYNC rate: a free numeric BARS-per-cycle input (the "4" of 4/1 = 4 bars,
  // open range for slow sweeps: 8, 16, 32…) + a straight/triplet/dotted FEEL
  // selector. Supersedes the old fixed RATIO dropdown.
  const barsWrap = document.createElement('div');
  barsWrap.className = 'knob mod-bars';
  const barsLabel = document.createElement('div');
  barsLabel.className = 'knob-label';
  barsLabel.textContent = 'BARS';
  const barsInput = document.createElement('input');
  barsInput.type = 'number';
  barsInput.min = '0.0625';
  barsInput.max = '64';
  barsInput.step = '0.0625';
  barsInput.value = String(mod.syncBars ?? 0.25);
  barsInput.className = 'mod-bars-field';
  barsInput.style.cssText =
    'width:4.6em;background:#1b1b1b;color:#eee;border:1px solid #444;border-radius:3px;' +
    'font:inherit;text-align:center;padding:2px 3px;';
  const commitBars = () => {
    const v = parseFloat(barsInput.value);
    if (!isFinite(v) || v <= 0) { barsInput.value = String(mod.syncBars ?? 0.25); return; }
    const run = () => { mod.syncBars = v; sync(deps); };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  };
  barsInput.addEventListener('change', commitBars);
  barsWrap.appendChild(barsLabel);
  barsWrap.appendChild(barsInput);
  row.appendChild(barsWrap);

  const subdiv = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.syncSubdiv`,
    label: 'FEEL',
    options: [
      { value: 'straight', label: 'Str' },
      { value: 'triplet',  label: 'Trip' },
      { value: 'dotted',   label: 'Dot' },
    ],
    initialValue: mod.syncSubdiv ?? 'straight',
    onChange: (v) => {
      const run = () => { mod.syncSubdiv = v as 'straight' | 'triplet' | 'dotted'; sync(deps); };
      if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
    },
  });
  deps.registerKnob(subdiv.handle);
  row.appendChild(subdiv.el);

  const syncBtn = document.createElement('button');
  const refreshSyncUI = () => {
    syncBtn.className = 'rnd' + (mod.syncToBpm ? ' primary' : '');
    syncBtn.textContent = mod.syncToBpm ? 'SYNC' : 'FREE';
    rate.el.style.display      = mod.syncToBpm ? 'none' : '';
    barsWrap.style.display     = mod.syncToBpm ? '' : 'none';
    subdiv.el.style.display    = mod.syncToBpm ? '' : 'none';
  };
  refreshSyncUI();
  syncBtn.addEventListener('click', () => {
    const run = () => { mod.syncToBpm = !mod.syncToBpm; sync(deps); };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
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
    onChange: (v) => {
      const run = () => { mod.bipolar = v === 'bi'; sync(deps); };
      if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
    },
  });
  deps.registerKnob(bipolar.handle);
  row.appendChild(bipolar.el);

  const trigger = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.trigger`,
    label: 'TRIG',
    options: [
      { value: 'free', label: 'Free' },
      { value: 'note', label: 'Note' },
    ],
    initialValue: mod.trigger ?? 'free',
    onChange: (v) => {
      const run = () => { mod.trigger = v as 'free' | 'note'; sync(deps); };
      if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
    },
  });
  deps.registerKnob(trigger.handle);
  row.appendChild(trigger.el);

  // SCOPE control: shared (engine-wide LFO) vs per-voice (one LFO per
  // note). Default 'shared' from makeDefaultLFO.
  const scope = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.scope`,
    label: 'SCOPE',
    options: [
      { value: 'shared',    label: 'Shared'   },
      { value: 'per-voice', label: 'PerVoice' },
    ],
    initialValue: mod.scope ?? 'shared',
    onChange: (v) => {
      const run = () => {
        mod.scope = v as 'shared' | 'per-voice';
        sync(deps);
        // Re-render the panel so TRIG visibility updates and the engine can
        // respawn modulator voices in the new scope.
        deps.onChange();
      };
      if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
    },
  });
  deps.registerKnob(scope.handle);
  row.appendChild(scope.el);

  // Hide TRIG when scope=per-voice (per-voice LFOs are always fresh with
  // the voice; the "free / note" distinction is meaningless).
  const refreshTrigVisibility = () => {
    trigger.el.style.display = (mod.scope ?? 'shared') === 'per-voice' ? 'none' : '';
  };
  refreshTrigVisibility();

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
      onChange: (v) => { mod[field] = v; sync(deps); },
      format: fmt,
      ...(deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {}),
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
  // Destinations come from the shared DestinationRegistry, which already
  // pushes a rebuild via subscribe() in renderModulatorsPanel — this
  // pointerdown/focus repopulate is a belt-and-braces refresh so opening the
  // dropdown never shows a stale list even if that subscription lapsed.
  const repopulate = (): void => {
    const keep = destSel.value;
    destSel.innerHTML = '';
    buildDestOptions(destSel, mod, deps);
    if (keep && [...destSel.options].some((o) => o.value === keep)) destSel.value = keep;
  };
  destSel.addEventListener('pointerdown', repopulate);
  destSel.addEventListener('focus', repopulate);
  buildDestOptions(destSel, mod, deps);

  const addBtn = document.createElement('button');
  addBtn.className = 'rnd primary';
  addBtn.textContent = '+ Destination';
  addBtn.addEventListener('click', () => {
    const paramId = destSel.value;
    if (!paramId) return;
    const run = () => {
      const cid = `c-${Date.now().toString(36)}`;
      deps.host.setConnection(mod.id, { id: cid, paramId, depth: 0.5 });
      sync(deps);
      deps.onChange();
    };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  });
  adder.appendChild(destSel);
  adder.appendChild(addBtn);
  list.appendChild(adder);

  return list;
}

/** Fill `destSel` with every param this modulator could still target, read
 *  from the one shared DestinationRegistry and grouped by its own lane
 *  names (session lanes first, then the global FX racks). Read fresh on
 *  every dropdown open, and whenever the registry announces a structural
 *  change (see the `subscribe` call in renderModulatorsPanel). */
function buildDestOptions(destSel: HTMLSelectElement, mod: ModulatorState, deps: ModulationUIDeps): void {
  const used = new Set(mod.connections.map((c) => c.paramId));
  // The per-lane binder (voice-mod-binding.ts's applyBinder) can only ever
  // resolve THIS lane's engine params + THIS lane's own insert chain + the
  // master insert chain — it never receives another lane's chain, and never
  // receives a send rack at all. A destination whose laneId is a different
  // lane, or `fx.send.*`, therefore matches nothing in the binder's destMap:
  // the connection would be created, look identical to a working one, and
  // silently never bind to an AudioParam. Keep this filter — it exists so
  // the dropdown never offers a target the binder can't reach.
  const targets = (deps.destinations?.list() ?? [])
    .filter((t) => t.laneId === deps.laneId || t.laneId === 'fx.master')
    .filter((t) => !used.has(t.id));
  for (const [laneName, group] of groupTargetsByLane(targets)) {
    const grp = document.createElement('optgroup');
    grp.label = laneName;
    for (const t of group) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      grp.appendChild(opt);
    }
    destSel.appendChild(grp);
  }
}

function renderConnectionRow(mod: ModulatorState, conn: import('./types').ModulationConnection, deps: ModulationUIDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mod-conn-row';

  const label = document.createElement('span');
  label.className = 'mod-conn-target';
  label.textContent = deps.lookupLaneDisplayName
    ? formatParamIdForDisplay(conn.paramId, deps.lookupLaneDisplayName)
    : conn.paramId;
  row.appendChild(label);

  const depthKnob = createKnob({
    id: `${deps.laneId}.mod.${mod.id}.conn.${conn.id}.depth`,
    label: 'DEPTH',
    min: -1, max: 1, step: 0.001,
    value: conn.depth, defaultValue: 0,
    onChange: (v) => {
      deps.host.setConnection(mod.id, { ...conn, depth: v });
      sync(deps);
    },
    format: (v) => v.toFixed(2),
    ...(deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {}),
  });
  deps.registerKnob(depthKnob);
  row.appendChild(depthKnob.el);

  const rmBtn = document.createElement('button');
  rmBtn.className = 'rnd';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => {
    const run = () => { deps.host.removeConnection(mod.id, conn.id); sync(deps); deps.onChange(); };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  });
  row.appendChild(rmBtn);

  return row;
}
