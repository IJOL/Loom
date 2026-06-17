// Automatic undo capture: diff a baseline snapshot against live state after
// interactions, committing the PRE-change state. Coalesces gestures (drags,
// focused text fields) so a whole interaction is one undo step. The single
// source of truth for undo — legacy withUndo/gesture helpers are no-ops.

import type { HistoryController } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';

export interface AutoHistoryDeps {
  history: HistoryController<SavedStateV3>;
  snapshot: () => SavedStateV3;
  restore: (s: SavedStateV3) => void;
  refreshAll: () => void;
}

export interface AutoHistory {
  checkpoint(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  markClean(): void;
  beginGesture(): void;
  endGesture(): void;
  onChange(cb: () => void): () => void;
  installGlobalListeners(doc: Document): () => void;
}

const eq = (a: SavedStateV3, b: SavedStateV3): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function createAutoHistory(deps: AutoHistoryDeps): AutoHistory {
  let baseline: SavedStateV3 = deps.snapshot();
  let gestureDepth = 0;
  const listeners: Array<() => void> = [];
  const notify = () => { for (const l of listeners) l(); };

  const self: AutoHistory = {
    checkpoint() {
      if (gestureDepth > 0) return;
      const cur = deps.snapshot();
      if (eq(cur, baseline)) return;
      deps.history.commit(baseline);
      baseline = cur;
      notify();
    },
    undo() {
      if (!deps.history.canUndo()) return;
      const prev = deps.history.undo(baseline);
      if (!prev) return;
      deps.restore(prev);
      baseline = deps.snapshot();
      deps.refreshAll();
      notify();
    },
    redo() {
      if (!deps.history.canRedo()) return;
      const next = deps.history.redo(baseline);
      if (!next) return;
      deps.restore(next);
      baseline = deps.snapshot();
      deps.refreshAll();
      notify();
    },
    canUndo: () => deps.history.canUndo(),
    canRedo: () => deps.history.canRedo(),
    markClean() {
      deps.history.clear();
      baseline = deps.snapshot();
      notify();
    },
    beginGesture() { gestureDepth++; },
    endGesture() {
      if (gestureDepth > 0) gestureDepth--;
      self.checkpoint();
    },
    onChange(cb) {
      listeners.push(cb);
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
    // Implemented in Task 2.
    installGlobalListeners() { return () => {}; },
  };
  return self;
}
