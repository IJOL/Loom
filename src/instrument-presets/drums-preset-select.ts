// The drums page's kit dropdown, #drums-preset-select.
//
// A different select from the instrument page's, because a drum "preset" is a
// KIT — an entry in the unified drum-kits list, grouped Synth / Samples — and
// applying one rebuilds the drums inspector rather than pushing param values.
// It keeps the `engine:<name>` option vocabulary so the shared selection
// bookkeeping in preset-select-state works for it unchanged.

import { html } from 'lit-html';
import { renderInto } from '../core/lit-fill';
import { customOption, presetGroup } from './poly-preset-templates';
import { getDrumKits, loadDrumKits, type DrumKitPreset } from '../presets/drum-kits-loader';
import { withUndo } from '../save/history-wiring';
import { pagePresetName, pageSelectActiveLane, presetControlsDeps } from './preset-select-state';

const SELECT_ID = 'drums-preset-select';

/** Called when the drums page is activated. */
export function mountDrumsPresetSelect(laneId: string): void {
  populateDrumKitsSelect(laneId);
  wireDrumKitsSelect(SELECT_ID, 'drums-preset-load');
}

function populateDrumKitsSelect(laneId: string): void {
  const sel = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  if (!sel) return;

  const holder = pageSelectActiveLane.get(SELECT_ID);
  if (!holder) pageSelectActiveLane.set(SELECT_ID, { laneId });
  else holder.laneId = laneId;

  const paint = () => {
    const groups = new Map<string, DrumKitPreset[]>();
    for (const k of getDrumKits()) {
      const arr = groups.get(k.group) ?? [];
      arr.push(k);
      groups.set(k.group, arr);
    }
    renderInto(sel, html`${customOption()}${[...groups].map(([group, entries]) =>
      presetGroup(group, entries.map((k) => [`engine:${k.name}`, k.name] as [string, string])))}`);
    sel.value = pagePresetName.get(laneId) ?? '__custom__';
  };

  paint();
  // If the loader hasn't resolved yet, re-render when it does (boot race).
  if (getDrumKits().length === 0) void loadDrumKits().then(paint);
}

function wireDrumKitsSelect(selectId: string, loadBtnId: string): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  if (sel.dataset.presetWired === '1') return;
  sel.dataset.presetWired = '1';

  const applySelected = () => {
    const holder = pageSelectActiveLane.get(selectId);
    if (!holder) return;
    const val = sel.value;
    if (!val.startsWith('engine:')) return;
    const name = val.slice('engine:'.length);
    // Record the selection BEFORE applying: applyDrumKitPreset rebuilds the
    // drums inspector synchronously, which re-populates this select and reads
    // pagePresetName. Setting it after made the dropdown snap back to
    // "(custom — no preset)" mid-apply.
    pagePresetName.set(holder.laneId, val);
    presetControlsDeps()?.applyDrumKitPreset?.(holder.laneId, name);
  };

  const undoable = () => {
    const history = presetControlsDeps()?.historyDeps;
    if (history) withUndo(history, applySelected);
    else applySelected();
  };

  sel.addEventListener('change', undoable);
  document.getElementById(loadBtnId)?.addEventListener('click', undoable);
}
