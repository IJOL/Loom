// src/performance/perf-keys.ts
// The Arrange surface's ACTIONS: keyboard editing (Delete, Ctrl+D, Ctrl+C/V)
// and the band context menu (Mute · Split at playhead · Duplicate · Delete).
// Same delegation shape as perf-gestures: listeners attach ONCE to persistent
// targets; every mutation goes through the deps so undo and refresh ride
// along in the feature. Keys are capture-phase and Performance-gated, exactly
// like the feature's own undo keys — an input/textarea keeps its keystrokes.

export interface PerfActionDeps {
  isActive(): boolean;
  getSelection(): ReadonlySet<string>;
  playheadSec(): number;
  deleteBands(ids: ReadonlySet<string>): void;
  duplicateBands(ids: ReadonlySet<string>): void;
  toggleMuteBands(ids: ReadonlySet<string>): void;
  splitBandsAt(ids: ReadonlySet<string>, sec: number): void;
  copyBands(ids: ReadonlySet<string>): void;
  pasteAtPlayhead(): void;
  /** Escape: abort a loop capture in flight. Returns true when one WAS active
   *  (the key is then consumed); false lets Escape keep its other meanings. */
  cancelCapture?(): boolean;
}

function editingText(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function attachPerfActions(root: HTMLElement, deps: PerfActionDeps): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!deps.isActive() || editingText(e)) return;
    const sel = deps.getSelection();
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' && deps.cancelCapture?.()) {
      e.preventDefault();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size > 0) {
      e.preventDefault(); deps.deleteBands(sel);
    } else if (ctrl && e.key.toLowerCase() === 'd' && sel.size > 0) {
      e.preventDefault(); deps.duplicateBands(sel);
    } else if (ctrl && e.key.toLowerCase() === 'c' && sel.size > 0) {
      e.preventDefault(); deps.copyBands(sel);
    } else if (ctrl && e.key.toLowerCase() === 'v') {
      e.preventDefault(); deps.pasteAtPlayhead();
    }
  };
  const onContext = (e: MouseEvent) => {
    const band = (e.target as HTMLElement).closest('.perf-clip') as HTMLElement | null;
    if (!band?.dataset.bandId) return;
    e.preventDefault();
    const id = band.dataset.bandId;
    const ids = deps.getSelection().has(id) ? deps.getSelection() : new Set([id]);
    openMenu(e.clientX, e.clientY, [
      ['Mute', () => deps.toggleMuteBands(ids)],
      ['Split at playhead', () => deps.splitBandsAt(ids, deps.playheadSec())],
      ['Duplicate', () => deps.duplicateBands(ids)],
      ['Delete', () => deps.deleteBands(ids)],
    ]);
  };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('contextmenu', onContext);
  return () => {
    document.removeEventListener('keydown', onKey, true);
    root.removeEventListener('contextmenu', onContext);
    closeMenu();
  };
}

let menuEl: HTMLElement | null = null;

function closeMenu(): void {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', onOutside, true);
}

function onOutside(e: Event): void {
  if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
}

function openMenu(x: number, y: number, items: [string, () => void][]): void {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'perf-context-menu';
  Object.assign(menuEl.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: '9999' });
  for (const [label, run] of items) {
    const item = document.createElement('div');
    item.className = 'perf-context-item';
    item.textContent = label;
    item.addEventListener('click', () => { closeMenu(); run(); });
    menuEl.appendChild(item);
  }
  document.body.appendChild(menuEl);
  document.addEventListener('pointerdown', onOutside, true);
}
