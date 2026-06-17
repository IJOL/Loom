import type { HistoryController } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';

export interface HistoryDeps {
  history: HistoryController<SavedStateV3>;
  snapshot: () => SavedStateV3;
  restore: (s: SavedStateV3) => void;
  /** Gesture bracket — delegate to AutoHistory so pointer-capture drags
   *  (piano-roll, drum-grid, knobs, faders) coalesce into one undo step.
   *  Wired in main.ts to autoHistory.beginGesture/endGesture. */
  beginGesture?: () => void;
  endGesture?: () => void;
}

/** Install Ctrl+Z / Cmd+Z / Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y on `document`,
 *  delegating to an undo controller (AutoHistory). Skips text-edit targets so
 *  native field undo wins. */
export function wireHistoryKeyboard(h: {
  canUndo(): boolean; canRedo(): boolean; undo(): void; redo(): void;
}): void {
  document.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      if (!h.canUndo()) return;
      e.preventDefault();
      h.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      if (!h.canRedo()) return;
      e.preventDefault();
      h.redo();
    }
  });
}

/** True when a keydown target is a text input / textarea / contentEditable
 *  region — used to skip global shortcuts so native text editing wins. */
export function isTextEditTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return type === 'text' || type === 'search' || type === 'email'
        || type === 'url' || type === 'tel' || type === 'password'
        || type === 'number' || type === '';
  }
  return false;
}

/** Neutralised: AutoHistory (src/save/auto-history.ts) is now the single source
 *  of undo capture. This helper only runs the mutation; the resulting state
 *  change is captured automatically on the next interaction checkpoint. Kept so
 *  the existing call sites compile unchanged. */
export function withUndo<R>(_d: HistoryDeps, fn: () => R): R {
  return fn();
}

/** Routes knob gesture brackets through AutoHistory's gestureDepth so
 *  pointer-capture knob drags coalesce into one undo step alongside the
 *  global pointerdown/pointerup listeners. */
export function attachKnobUndo(d: HistoryDeps): {
  onGestureStart: () => void;
  onGestureEnd: () => void;
} {
  return {
    onGestureStart: () => d.beginGesture?.(),
    onGestureEnd:   () => d.endGesture?.(),
  };
}
