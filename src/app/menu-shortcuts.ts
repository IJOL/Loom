// src/app/menu-shortcuts.ts
// Binds ONLY the new accelerators (Ctrl/Cmd+N/O/S). Ctrl+Z / Ctrl+Shift+Z /
// Ctrl+I are already owned by existing global handlers — we only DISPLAY those
// in the menu, never re-bind them here (avoids double-firing).
import { isTextEditTarget } from '../save/history-wiring';

export function registerMenuShortcuts(a: {
  newSession: () => void; openSaveForLoad: () => void; openSaveForSave: () => void;
}): void {
  window.addEventListener('keydown', (e) => {
    // Skip while the user is typing in a text field — Ctrl+S/N/O are common
    // native text-editing chords too and must not steal focus mid-type.
    if (isTextEditTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); a.newSession(); }
    else if (k === 'o') { e.preventDefault(); a.openSaveForLoad(); }
    else if (k === 's') { e.preventDefault(); a.openSaveForSave(); }
  });
}
