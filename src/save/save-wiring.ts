import {
  saveNamedEntry, readIndex, loadEntry, loadAutosave,
  deleteEntry, renameEntry, clearAll, totalStorageKB,
  downloadAsJson, loadFromFile,
  type SaveIndexEntry,
} from './save-manager';
import { alertDialog, confirmDialog, promptDialog } from '../core/dialog';
import type { Sequencer } from '../core/sequencer';
import type { FxBus } from '../core/fx';
import type { InsertChain } from '../plugins/fx/insert-chain';
import type { SessionHost } from '../session/session-host';
import type { HistoryController } from '../core/history';
import type { LaneAllocator } from '../app/lane-allocator';
import {
  buildSavedStateV3, applyLoadedStateV3, parseSavedStateV3,
  type SavedStateV3, type SavedStateV3Deps,
} from './saved-state-v3';
import type { ArrangementState } from '../performance/performance';

// Phase G: SaveWiringDeps no longer includes direct synth/drums refs.
// They are resolved at save/load time from lanes.resources.
export interface SaveWiringDeps {
  ctx: AudioContext;
  seq: Sequencer;
  lanes: LaneAllocator;
  master: GainNode;
  volInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  meterSel: HTMLSelectElement;
  sessionHost: SessionHost;
  refreshKnobsFromSynth: () => void;
  renderLanes: () => void;
  fx: FxBus;
  masterInsertChain: InsertChain;
  masterStrip?: import('../core/master-bus-strip').MasterBusStrip;
  masterComp?: import('../core/fx').MasterCompressor;
  flashButton: (b: HTMLButtonElement, msg: string) => void;
  history: HistoryController<SavedStateV3>;
  /** Performance view persistence (optional). Wired for save/load only — NOT
   *  for undo/redo snapshots (recording a take is not an undoable session edit). */
  getMode?: () => 'session' | 'performance';
  getArrangement?: () => ArrangementState;
  setMode?: (m: 'session' | 'performance') => void;
  setArrangement?: (a: ArrangementState) => void;
  /** Called after a save file is applied (load/autosave). Used to resync the
   *  AutoHistory baseline so the loaded state is the new clean baseline. */
  onAfterApply?: () => void;
}

function applyLoadedState(data: unknown, deps: SaveWiringDeps): void {
  const s = parseSavedStateV3(data);
  if (!s) {
    if (data && typeof data === 'object' && 'schemaVersion' in data) {
      console.warn('[SaveManager] Ignoring legacy save file (schemaVersion < 3). Classic mode no longer supported.');
    } else {
      void alertDialog('Invalid save data');
    }
    return;
  }
  applyLoadedStateV3(s, deps);
  deps.history.clear();
  deps.onAfterApply?.();
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
    row.querySelector<HTMLButtonElement>('[data-act=ren]')!.onclick = async () => {
      const next = await promptDialog('Rename:', entry.name);
      if (next) { renameEntry(entry.id, next); openSaveManager(deps, applyLoaded); }
    };
    row.querySelector<HTMLButtonElement>('[data-act=del]')!.onclick = async () => {
      if (await confirmDialog(`Delete "${entry.name}"?`)) { deleteEntry(entry.id); openSaveManager(deps, applyLoaded); }
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
      void alertDialog('Invalid save file: ' + (err as Error).message);
    }
  });
  document.getElementById('save-manager-clear-all')!.addEventListener('click', async () => {
    if (await confirmDialog('Clear ALL saves? Autosave is preserved.')) {
      clearAll();
      openManager();
    }
  });

  // In-app save: a name field + "Save current" button live inside the modal.
  // This replaces the old native `window.prompt`, which Chrome silently
  // suppresses after a "prevent additional dialogs" dismissal — the toolbar
  // Save click then no-ops with no visible dialog and nothing persisted (the
  // reported "click Save, nothing happens, Load shows nothing" bug). The
  // toolbar Save button now just opens this modal with the name field focused.
  const nameInput = document.getElementById('save-manager-name') as HTMLInputElement | null;
  const saveBtn = document.getElementById('save-manager-save') as HTMLButtonElement | null;
  const defaultName = () => `Session ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const commitSave = () => {
    const name = nameInput?.value.trim() || defaultName();
    const state = buildSavedStateV3(deps);
    saveNamedEntry(name, state);
    // Re-render the list so the new entry shows immediately; keeps modal open.
    openSaveManager(deps, applyLoaded);
    if (nameInput) nameInput.value = '';
    if (saveBtn) deps.flashButton(saveBtn, 'Saved!');
  };
  saveBtn?.addEventListener('click', commitSave);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitSave(); }
  });
  const openManagerForSave = () => {
    openManager();
    if (nameInput) { nameInput.value = defaultName(); nameInput.focus(); nameInput.select(); }
  };

  // Replace existing Save/Load button handlers
  const existingSaveBtn = document.getElementById('save');
  const existingLoadBtn = document.getElementById('load');
  if (existingSaveBtn) {
    const newSave = existingSaveBtn.cloneNode(true) as HTMLButtonElement;
    existingSaveBtn.parentNode!.replaceChild(newSave, existingSaveBtn);
    newSave.addEventListener('click', openManagerForSave);
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
