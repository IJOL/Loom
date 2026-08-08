// src/session/project-options-dialog.ts
// File ▸ Project Options: project name + key/scale/style/lock. Per-project state.
import { html, render } from 'lit-html';
import { SCALE_CATALOG, STYLE_CATALOG, rootName, type ScaleId, type StyleId } from '../core/musicality';
import type { MusicalityState } from './session-types';
import { bindModalDialog } from '../app/modal-dialog';

export interface ProjectOptionsDeps {
  getName(): string;
  setName(name: string): void;
  getMusicality(): MusicalityState;
  setMusicality(m: MusicalityState): void;
  /** THIS MACHINE's preferences, kept visibly apart from the project's own.
   *
   *  They share a dialog because building a second one for a single checkbox is
   *  more UI than the setting needs — but they must not read as project state: a
   *  project travels, and loading someone else's session must not turn your
   *  autosave on. Optional so callers without the prefs store keep working. */
  getAutosave?(): boolean;
  setAutosave?(on: boolean): void;
}

export function renderProjectOptionsDialog(deps: ProjectOptionsDeps): { open(): void; refresh(): void } {
  const modal = bindModalDialog('project-options-dialog');
  const body = document.getElementById('project-options-body')!;

  const commitMus = () => deps.setMusicality({
    key: Number(rootSel.value), scale: scaleSel.value as ScaleId, style: styleSel.value as StyleId, lock: lockChk.checked,
  });

  // Built ONCE into the modal body; refresh() writes the live values back
  // imperatively on every open. (A template re-render couldn't do that job:
  // lit dirty-checks a `.value` binding against its last commit, not against
  // what the user typed into the field.)
  render(html`
    <div class="po-group">Project</div>
    <label class="po-row"><span>Name</span><input type="text" data-po="name" class="po-name" placeholder="Untitled" @change=${() => deps.setName(nameInput.value.trim() || 'Untitled')} /></label>
    <div class="po-group">Key & style</div>
    <label class="po-row"><span>Root</span><select data-po="root" @change=${commitMus}>${Array.from({ length: 12 }, (_, pc) => html`<option value=${String(pc)}>${rootName(pc)}</option>`)}</select></label>
    <label class="po-row"><span>Scale</span><select data-po="scale" @change=${commitMus}>${SCALE_CATALOG.map((s) => html`<option value=${s.id}>${`${s.mood} — ${s.label} · ${s.hint}`}</option>`)}</select></label>
    <label class="po-row"><span>Style</span><select data-po="style" @change=${commitMus}>${STYLE_CATALOG.map((s) => html`<option value=${s.id}>${s.label}</option>`)}</select></label>
    <label class="po-row"><span>Lock notes to key</span><input type="checkbox" data-po="lock" title="When ON, notes you place snap to the project key" @change=${commitMus} /></label>
    ${deps.setAutosave ? html`
      <div class="po-group">This computer</div>
      <label class="po-row">
        <span>Autosave</span>
        <input
          type="checkbox"
          data-po="autosave"
          title="Keep the recovery copy up to date as you work. Off by default: it overwrites the ONE recovery slot, and the moment you most want that slot is the moment after something went wrong."
          @change=${() => deps.setAutosave?.(autosaveChk.checked)}
        />
      </label>
      <p class="po-note">Overwrites the single recovery copy as you work. Your named saves are never touched.</p>
    ` : ''}
  `, body);

  const nameInput = body.querySelector<HTMLInputElement>('input[data-po="name"]')!;
  const rootSel   = body.querySelector<HTMLSelectElement>('select[data-po="root"]')!;
  const scaleSel  = body.querySelector<HTMLSelectElement>('select[data-po="scale"]')!;
  const styleSel  = body.querySelector<HTMLSelectElement>('select[data-po="style"]')!;
  const lockChk   = body.querySelector<HTMLInputElement>('input[data-po="lock"]')!;
  const autosaveChk = body.querySelector<HTMLInputElement>('input[data-po="autosave"]')!;

  const refresh = () => {
    nameInput.value = deps.getName();
    const m = deps.getMusicality();
    rootSel.value = String(m.key); scaleSel.value = m.scale; styleSel.value = m.style; lockChk.checked = m.lock;
    // Read on every open rather than trusted from the last write: another tab
    // shares this preference, and it is stored outside the session.
    if (autosaveChk) autosaveChk.checked = deps.getAutosave?.() ?? false;
  };

  return { open: () => { refresh(); modal.open(); }, refresh };
}
