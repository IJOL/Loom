// src/session/project-options-dialog.ts
// File ▸ Project Options: project name + key/scale/style/lock. Per-project state.
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

  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.dataset.po = 'name'; nameInput.className = 'po-name';
  nameInput.placeholder = 'Untitled';

  const rootSel = document.createElement('select'); rootSel.dataset.po = 'root';
  for (let pc = 0; pc < 12; pc++) {
    const o = document.createElement('option'); o.value = String(pc); o.textContent = rootName(pc); rootSel.appendChild(o);
  }
  const scaleSel = document.createElement('select'); scaleSel.dataset.po = 'scale';
  for (const s of SCALE_CATALOG) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = `${s.mood} — ${s.label} · ${s.hint}`; scaleSel.appendChild(o);
  }
  const styleSel = document.createElement('select'); styleSel.dataset.po = 'style';
  for (const s of STYLE_CATALOG) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; styleSel.appendChild(o);
  }
  const lockChk = document.createElement('input'); lockChk.type = 'checkbox'; lockChk.dataset.po = 'lock';
  lockChk.title = 'When ON, notes you place snap to the project key';

  const row = (label: string, el: HTMLElement) => {
    const r = document.createElement('label'); r.className = 'po-row';
    const s = document.createElement('span'); s.textContent = label; r.append(s, el); return r;
  };
  const group = (label: string) => { const g = document.createElement('div'); g.className = 'po-group'; g.textContent = label; return g; };

  body.append(
    group('Project'), row('Name', nameInput),
    group('Key & style'), row('Root', rootSel), row('Scale', scaleSel), row('Style', styleSel), row('Lock notes to key', lockChk),
  );

  const commitMus = () => deps.setMusicality({
    key: Number(rootSel.value), scale: scaleSel.value as ScaleId, style: styleSel.value as StyleId, lock: lockChk.checked,
  });
  nameInput.addEventListener('change', () => deps.setName(nameInput.value.trim() || 'Untitled'));
  rootSel.addEventListener('change', commitMus);
  scaleSel.addEventListener('change', commitMus);
  styleSel.addEventListener('change', commitMus);
  lockChk.addEventListener('change', commitMus);

  const refresh = () => {
    nameInput.value = deps.getName();
    const m = deps.getMusicality();
    rootSel.value = String(m.key); scaleSel.value = m.scale; styleSel.value = m.style; lockChk.checked = m.lock;
  };

  return { open: () => { refresh(); modal.open(); }, refresh };
}
