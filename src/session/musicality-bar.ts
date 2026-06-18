// src/session/musicality-bar.ts
// Tonality + style panel for the top bar. Replaces the loose #scale/#root <select>s.
// Displays scales by feel (mood + hint).
import {
  SCALE_CATALOG, STYLE_CATALOG, rootName, type ScaleId, type StyleId,
} from '../core/musicality';
import type { MusicalityState } from './session';

export interface MusicalityBarDeps {
  get: () => MusicalityState;
  onChange: (next: MusicalityState) => void;
}
export interface MusicalityBarHandle { refresh: () => void; }

export function renderMusicalityBar(host: HTMLElement, deps: MusicalityBarDeps): MusicalityBarHandle {
  host.innerHTML = '';
  host.className = 'musicality-bar';

  const summary = document.createElement('button');
  summary.className = 'musicality-summary';
  summary.title = 'Project key & style';

  const popover = document.createElement('div');
  popover.className = 'musicality-popover';
  popover.hidden = true;

  const rootSel = document.createElement('select');
  rootSel.dataset.musicality = 'root';
  for (let pc = 0; pc < 12; pc++) {
    const o = document.createElement('option'); o.value = String(pc); o.textContent = rootName(pc);
    rootSel.appendChild(o);
  }
  const scaleSel = document.createElement('select');
  scaleSel.dataset.musicality = 'scale';
  for (const s of SCALE_CATALOG) {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = `${s.mood} — ${s.label} · ${s.hint}`;
    scaleSel.appendChild(o);
  }
  const styleSel = document.createElement('select');
  styleSel.dataset.musicality = 'style';
  for (const s of STYLE_CATALOG) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.label;
    styleSel.appendChild(o);
  }
  // Global scale lock. When ON, the piano-roll snaps placed notes to the key;
  // OFF means you can play anything. This is the single global source of truth
  // (the piano-roll's own 🔒 button writes the same musicality.lock).
  const lockChk = document.createElement('input');
  lockChk.type = 'checkbox';
  lockChk.dataset.musicality = 'lock';
  lockChk.title = 'When ON, notes you place snap to the project key';

  const mkRow = (label: string, el: HTMLElement) => {
    const row = document.createElement('label'); row.className = 'musicality-row';
    const span = document.createElement('span'); span.textContent = label;
    row.append(span, el); return row;
  };
  popover.append(
    mkRow('Root', rootSel),
    mkRow('Scale', scaleSel),
    mkRow('Style', styleSel),
    mkRow('Scale lock', lockChk),
  );

  const summaryText = (m: MusicalityState) => {
    const sc = SCALE_CATALOG.find((s) => s.id === m.scale);
    const st = STYLE_CATALOG.find((s) => s.id === m.style);
    return `${rootName(m.key)} ${sc?.label ?? m.scale} · ${st?.label ?? m.style}`;
  };
  const refresh = () => {
    const m = deps.get();
    rootSel.value = String(((m.key % 12) + 12) % 12);
    scaleSel.value = m.scale;
    styleSel.value = m.style;
    lockChk.checked = m.lock;
    // 🔒/🔓 in the summary so the lock state is visible at a glance, without
    // opening the popover or any clip editor.
    summary.textContent = `🎼 ${summaryText(m)} · ${m.lock ? '🔒' : '🔓'}`;
  };

  const emit = () => {
    const cur = deps.get();
    deps.onChange({
      ...cur,
      key: parseInt(rootSel.value, 10),
      scale: scaleSel.value as ScaleId,
      style: styleSel.value as StyleId,
      lock: lockChk.checked,
    });
    refresh();
  };
  for (const el of [rootSel, scaleSel, styleSel, lockChk]) el.addEventListener('change', emit);
  summary.addEventListener('click', () => { popover.hidden = !popover.hidden; });

  host.append(summary, popover);
  refresh();
  return { refresh };
}
