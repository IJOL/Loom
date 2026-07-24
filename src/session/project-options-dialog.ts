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
  `, body);

  const nameInput = body.querySelector<HTMLInputElement>('input[data-po="name"]')!;
  const rootSel   = body.querySelector<HTMLSelectElement>('select[data-po="root"]')!;
  const scaleSel  = body.querySelector<HTMLSelectElement>('select[data-po="scale"]')!;
  const styleSel  = body.querySelector<HTMLSelectElement>('select[data-po="style"]')!;
  const lockChk   = body.querySelector<HTMLInputElement>('input[data-po="lock"]')!;

  const refresh = () => {
    nameInput.value = deps.getName();
    const m = deps.getMusicality();
    rootSel.value = String(m.key); scaleSel.value = m.scale; styleSel.value = m.style; lockChk.checked = m.lock;
  };

  return { open: () => { refresh(); modal.open(); }, refresh };
}
