import {
  DRUM_PRESETS, BASS_PRESETS, MELODY_PRESETS,
  loadDrumPreset, loadBassPreset, loadMelodyPreset,
} from './presets';
import type { Sequencer } from '../core/sequencer';
import { withUndo, type HistoryDeps } from '../save/history-wiring';

export interface PresetLibraryUIDeps {
  seq: Sequencer;
  /** When provided, each "Load" click is wrapped with withUndo so it becomes
   *  one undoable entry. Omit for programmatic/session-load callers. */
  historyDeps?: HistoryDeps;
}

export function wirePresetLibrary(deps: PresetLibraryUIDeps): void {
  const { seq, historyDeps } = deps;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const drumSel   = $<HTMLSelectElement>('preset-drums');
  const bassSel   = $<HTMLSelectElement>('preset-bass');
  const melodySel = $<HTMLSelectElement>('preset-melody');

  for (const p of DRUM_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    drumSel.appendChild(opt);
  }
  for (const p of BASS_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    bassSel.appendChild(opt);
  }
  for (const p of MELODY_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — ${p.description}`;
    melodySel.appendChild(opt);
  }

  $<HTMLButtonElement>('preset-drums-load').addEventListener('click', () => {
    const p = DRUM_PRESETS.find((x) => x.id === drumSel.value);
    if (!p) return;
    const run = () => loadDrumPreset(seq, p);
    if (historyDeps) withUndo(historyDeps, run); else run();
  });
  $<HTMLButtonElement>('preset-bass-load').addEventListener('click', () => {
    const p = BASS_PRESETS.find((x) => x.id === bassSel.value);
    if (!p) return;
    const run = () => loadBassPreset(seq, p);
    if (historyDeps) withUndo(historyDeps, run); else run();
  });
  $<HTMLButtonElement>('preset-melody-load').addEventListener('click', () => {
    const p = MELODY_PRESETS.find((x) => x.id === melodySel.value);
    if (!p) return;
    const run = () => loadMelodyPreset(seq, p);
    if (historyDeps) withUndo(historyDeps, run); else run();
  });
}
