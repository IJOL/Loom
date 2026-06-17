// Wire the header Undo/Redo buttons to an undo controller, keeping their
// enabled/disabled state in sync with the history stacks.
export interface UndoButtonDeps {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  onChange(cb: () => void): () => void;
}

export function wireUndoButtons(d: UndoButtonDeps): void {
  const u = document.getElementById('undo-btn') as HTMLButtonElement | null;
  const r = document.getElementById('redo-btn') as HTMLButtonElement | null;
  if (!u || !r) return;
  u.addEventListener('click', () => d.undo());
  r.addEventListener('click', () => d.redo());
  const sync = () => { u.disabled = !d.canUndo(); r.disabled = !d.canRedo(); };
  d.onChange(sync);
  sync();
}
