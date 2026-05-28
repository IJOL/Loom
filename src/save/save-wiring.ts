import {
  saveNamedEntry, readIndex, loadEntry, loadAutosave,
  deleteEntry, renameEntry, clearAll, totalStorageKB,
  downloadAsJson, loadFromFile,
  type SaveIndexEntry,
} from './save-manager';
import type { Sequencer } from '../core/sequencer';
import type { TB303 } from '../core/synth';
import type { DrumMachine } from '../core/drums';
import type { FxBus, FilterChain } from '../core/fx';
import type { SessionHost } from '../session/session-host';
import type { SessionState } from '../session/session';

export interface SaveWiringDeps {
  seq: Sequencer;
  synth: TB303;
  drums: DrumMachine;
  master: GainNode;
  volInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  kitSel: HTMLSelectElement;
  waveSel: HTMLSelectElement;
  sessionHost: SessionHost;
  refreshKnobsFromSynth: () => void;
  renderLanes: () => void;
  fx: FxBus;
  filterChain: FilterChain;
  flashButton: (b: HTMLButtonElement, msg: string) => void;
}

function buildSavedStateV3(deps: SaveWiringDeps): Record<string, unknown> {
  const { seq, synth, drums, master, volInput, sessionHost } = deps;
  return {
    schemaVersion: 3,
    bpm: seq.bpm,
    swing: seq.swing,
    masterVol: parseFloat(volInput.value),
    kit: drums.kitId,
    wave: synth.params.wave,
    synthParams: { ...synth.params },
    sessionState: sessionHost.getStateForSave(),
  };
}

function applyLoadedState(data: unknown, deps: SaveWiringDeps): void {
  const { seq, synth, drums, master, volInput, bpmInput, swingInput, kitSel, waveSel, sessionHost, refreshKnobsFromSynth, renderLanes, fx, filterChain } = deps;

  if (!data || typeof data !== 'object') { alert('Invalid save data'); return; }
  const s = data as Record<string, unknown>;

  // Only accept schemaVersion 3 (session-only). Legacy saves (v1/v2) are dropped
  // because Classic mode no longer exists and the bank/slots format is gone.
  if (s.schemaVersion !== 3) {
    console.warn('[SaveManager] Ignoring legacy save file (schemaVersion < 3). Classic mode no longer supported.');
    return;
  }

  if (typeof s.bpm === 'number') { seq.bpm = s.bpm; bpmInput.value = String(s.bpm); }
  if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }
  if (typeof s.masterVol === 'number') { master.gain.value = s.masterVol; volInput.value = String(s.masterVol); }
  if (typeof s.kit === 'string') { drums.setKit(s.kit); kitSel.value = s.kit; }
  if (s.wave) { synth.params.wave = s.wave as typeof synth.params.wave; waveSel.value = String(s.wave); }
  if (s.synthParams) synth.params = { ...synth.params, ...(s.synthParams as object) };
  if (s.sessionState && typeof s.sessionState === 'object') {
    sessionHost.applyLoadedSessionState(s.sessionState as SessionState);
  }
  refreshKnobsFromSynth();
  renderLanes();
  fx.setBpmSync(seq.bpm);
  filterChain.updateBpm(seq.bpm);
}

function openSaveManager(deps: SaveWiringDeps, applyLoaded: (data: unknown) => void): void {
  const modal = document.getElementById('save-manager-modal')!;
  const list  = document.getElementById('save-manager-list')!;
  modal.hidden = false;
  list.innerHTML = '';

  const autosaveRow = document.createElement('div');
  autosaveRow.className = 'save-manager-row autosave';
  autosaveRow.innerHTML = `
    <span>Auto-save (latest)</span>
    <span>—</span>
    <span>—</span>
    <button data-act="load">Load</button>
    <span></span><span></span><span></span>
  `;
  autosaveRow.querySelector<HTMLButtonElement>('[data-act=load]')!.onclick = () => {
    const data = loadAutosave();
    if (data) applyLoaded(data);
    closeSaveManager();
  };
  list.appendChild(autosaveRow);

  const idx: SaveIndexEntry[] = readIndex().sort((a, b) => b.timestamp - a.timestamp);
  for (const entry of idx) {
    const row = document.createElement('div');
    row.className = 'save-manager-row';
    const d = new Date(entry.timestamp).toLocaleString();
    row.innerHTML = `
      <span>${entry.name}</span>
      <span>${d}</span>
      <span>${entry.sizeKB} KB</span>
      <button data-act="load">Load</button>
      <button data-act="dl">⤓</button>
      <button data-act="ren">✎</button>
      <button data-act="del">🗑</button>
    `;
    row.querySelector<HTMLButtonElement>('[data-act=load]')!.onclick = () => {
      const data = loadEntry(entry.id);
      if (data) applyLoaded(data);
      closeSaveManager();
    };
    row.querySelector<HTMLButtonElement>('[data-act=dl]')!.onclick = () => {
      const data = loadEntry(entry.id);
      if (data) downloadAsJson(`tb303-${entry.name.replace(/[^\w-]+/g, '_')}.json`, data);
    };
    row.querySelector<HTMLButtonElement>('[data-act=ren]')!.onclick = () => {
      const next = window.prompt('Rename:', entry.name);
      if (next) { renameEntry(entry.id, next); openSaveManager(deps, applyLoaded); }
    };
    row.querySelector<HTMLButtonElement>('[data-act=del]')!.onclick = () => {
      if (window.confirm(`Delete "${entry.name}"?`)) { deleteEntry(entry.id); openSaveManager(deps, applyLoaded); }
    };
    list.appendChild(row);
  }

  const sizeEl = document.getElementById('save-manager-size')!;
  sizeEl.textContent = `Total: ${totalStorageKB()} KB`;
}

function closeSaveManager(): void {
  document.getElementById('save-manager-modal')!.hidden = true;
}

export function wireSaveManager(deps: SaveWiringDeps): void {
  const applyLoaded = (data: unknown) => applyLoadedState(data, deps);
  const openManager = () => openSaveManager(deps, applyLoaded);

  document.getElementById('save-manager-close')!.addEventListener('click', closeSaveManager);
  document.querySelector('.save-manager-backdrop')!.addEventListener('click', closeSaveManager);

  document.getElementById('save-manager-load-file')!.addEventListener('click', () => {
    document.getElementById('save-manager-file')!.click();
  });
  document.getElementById('save-manager-file')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = await loadFromFile(file);
      applyLoaded(data);
      closeSaveManager();
    } catch (err) {
      alert('Invalid save file: ' + (err as Error).message);
    }
  });
  document.getElementById('save-manager-clear-all')!.addEventListener('click', () => {
    if (window.confirm('Clear ALL saves? Autosave is preserved.')) {
      clearAll();
      openManager();
    }
  });

  // Replace existing Save/Load button handlers
  const existingSaveBtn = document.getElementById('save');
  const existingLoadBtn = document.getElementById('load');
  if (existingSaveBtn) {
    const newSave = existingSaveBtn.cloneNode(true) as HTMLButtonElement;
    existingSaveBtn.parentNode!.replaceChild(newSave, existingSaveBtn);
    newSave.addEventListener('click', () => {
      const def = `Sesión ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const name = window.prompt('Save name:', def);
      if (!name) return;
      const state = buildSavedStateV3(deps);
      saveNamedEntry(name, state);
      downloadAsJson(`tb303-${name.replace(/[^\w-]+/g, '_')}.json`, state);
      deps.flashButton(newSave, 'Saved!');
    });
  }
  if (existingLoadBtn) {
    const newLoad = existingLoadBtn.cloneNode(true) as HTMLButtonElement;
    existingLoadBtn.parentNode!.replaceChild(newLoad, existingLoadBtn);
    newLoad.addEventListener('click', openManager);
  }
}

export function bootRecoveryLoad(deps: SaveWiringDeps): void {
  const recovered = loadAutosave();
  if (recovered) applyLoadedState(recovered, deps);
}
