// Automatic undo capture: diff a baseline snapshot against live state after
// interactions, committing the PRE-change state. Coalesces gestures (drags,
// focused text fields) so a whole interaction is one undo step. The single
// source of truth for undo — legacy withUndo/gesture helpers are no-ops.

import type { HistoryController } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';
import { isTextEditTarget } from './history-wiring';

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
      if (prev === null) return;
      deps.restore(prev);
      baseline = deps.snapshot();
      deps.refreshAll();
      notify();
    },
    redo() {
      if (!deps.history.canRedo()) return;
      const next = deps.history.redo(baseline);
      if (next === null) return;
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
    installGlobalListeners(doc: Document) {
      let wheelTimer: ReturnType<typeof setTimeout> | null = null;
      const micro = (fn: () => void) => queueMicrotask(fn);

      // --- Fix B: leak-proof model ---
      // activePointers tracks pointer ids currently in flight (pointerdown received,
      // no pointerup/pointercancel yet). textFieldFocused tracks whether a text edit
      // focus gesture is open. Together they allow self-healing: if a fresh
      // pointerdown arrives while activePointers WAS empty (no pointer in flight) yet
      // gestureDepth > 0, that residual depth is a stale leak from a prior
      // interaction — safe to reset BEFORE beginGesture() so undo stays usable.
      const activePointers = new Set<number>();
      let textFieldFocused = false;

      const onPointerDown = (e: Event) => {
        const pe = e as PointerEvent;
        // Self-heal: if no pointer was in flight and no text field is focused,
        // any non-zero gestureDepth is a leak — reset it.
        if (activePointers.size === 0 && !textFieldFocused && gestureDepth > 0) {
          gestureDepth = 0;
        }
        activePointers.add(pe.pointerId);
        self.beginGesture();
      };
      // pointerup: schedule endGesture as a microtask so it runs after the full
      // pointerup dispatch (including bubble handlers that perform the mutation)
      // but still within the same browser task — before the next macrotask such as
      // a Ctrl+Z keydown. This covers drag-only paths (no click follows). For
      // button clicks, this microtask runs before the click event, so its
      // checkpoint is a no-op; the onClick bubble listener below captures those.
      // For drag paths that use setPointerCapture, the mutation callback must also
      // call checkpointHistory() directly, since the captured element's pointerup
      // handler fires in a separate dispatch cycle after the microtask drains.
      const onPointerEnd = (e: Event) => {
        const pe = e as PointerEvent;
        activePointers.delete(pe.pointerId);
        micro(() => self.endGesture());
      };
      // click (bubble, fires AFTER the target's click handler): close the gesture
      // and checkpoint synchronously. This fires after the mutation so the diff is
      // captured reliably — fixing both real browser and Playwright timer races.
      // For drags (no click follows pointerup), the microtask path above handles it.
      const onClick = () => self.endGesture();
      const onKeyUp = (e: Event) => {
        const ke = e as KeyboardEvent;
        const cmd = ke.metaKey || ke.ctrlKey;
        const k = ke.key.toLowerCase();
        if (cmd && (k === 'z' || k === 'y')) return;      // undo/redo shortcut
        if (isTextEditTarget(ke.target)) return;          // text fields → focus/blur path
        micro(() => self.checkpoint());
      };
      const onChange = () => micro(() => self.checkpoint());
      const onDrop = () => micro(() => self.checkpoint());
      const onWheel = () => {
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelTimer = null; self.checkpoint(); }, 250);
      };
      const onFocusIn = (e: Event) => {
        if (isTextEditTarget((e as FocusEvent).target)) {
          textFieldFocused = true;
          self.beginGesture();
        }
      };
      const onFocusOut = (e: Event) => {
        if (isTextEditTarget((e as FocusEvent).target)) {
          textFieldFocused = false;
          micro(() => self.endGesture());
        }
      };

      const opts = { capture: true } as const;
      doc.addEventListener('pointerdown', onPointerDown, opts);
      doc.addEventListener('pointerup', onPointerEnd, opts);
      // Fix A: pointercancel ends the gesture just like pointerup (same handler)
      doc.addEventListener('pointercancel', onPointerEnd, opts);
      // click: bubble phase (no capture) so it fires AFTER the target's listener
      doc.addEventListener('click', onClick);
      doc.addEventListener('keyup', onKeyUp, opts);
      doc.addEventListener('change', onChange, opts);
      doc.addEventListener('drop', onDrop, opts);
      doc.addEventListener('wheel', onWheel, opts);
      doc.addEventListener('focusin', onFocusIn, opts);
      doc.addEventListener('focusout', onFocusOut, opts);

      return () => {
        doc.removeEventListener('pointerdown', onPointerDown, opts);
        doc.removeEventListener('pointerup', onPointerEnd, opts);
        doc.removeEventListener('pointercancel', onPointerEnd, opts);
        doc.removeEventListener('click', onClick);
        doc.removeEventListener('keyup', onKeyUp, opts);
        doc.removeEventListener('change', onChange, opts);
        doc.removeEventListener('drop', onDrop, opts);
        doc.removeEventListener('wheel', onWheel, opts);
        doc.removeEventListener('focusin', onFocusIn, opts);
        doc.removeEventListener('focusout', onFocusOut, opts);
        if (wheelTimer) clearTimeout(wheelTimer);
      };
    },
  };
  return self;
}
