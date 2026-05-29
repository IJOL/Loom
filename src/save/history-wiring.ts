import type { HistoryController } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';

export interface HistoryDeps {
  history: HistoryController<SavedStateV3>;
  snapshot: () => SavedStateV3;
  restore: (s: SavedStateV3) => void;
}

/** Install Ctrl+Z / Cmd+Z / Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y on `document`.
 *  Ignores the event when typing in text inputs / textareas / contentEditable so
 *  native undo inside save-name prompts etc. is preserved. */
export function wireHistoryKeyboard(d: HistoryDeps): void {
  document.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      if (!d.history.canUndo()) return;
      e.preventDefault();
      const prev = d.history.undo(d.snapshot());
      if (prev) d.restore(prev);
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      if (!d.history.canRedo()) return;
      e.preventDefault();
      const next = d.history.redo(d.snapshot());
      if (next) d.restore(next);
    }
  });
}

function isTextEditTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return type === 'text' || type === 'search' || type === 'email'
        || type === 'url' || type === 'tel' || type === 'password' || type === '';
  }
  return false;
}

/** Discrete-action helper: snapshot before, then mutate. */
export function withUndo<R>(d: HistoryDeps, fn: () => R): R {
  d.history.commit(d.snapshot());
  return fn();
}
