// src/app/menu-shortcuts.ts
// Binds ONLY the new accelerators (Ctrl/Cmd+N/O/S). Ctrl+Z / Ctrl+Shift+Z /
// Ctrl+I are already owned by existing global handlers — we only DISPLAY those
// in the menu, never re-bind them here (avoids double-firing).
export function registerMenuShortcuts(a: {
  newSession: () => void; openSaveForLoad: () => void; openSaveForSave: () => void;
}): void {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); a.newSession(); }
    else if (k === 'o') { e.preventDefault(); a.openSaveForLoad(); }
    else if (k === 's') { e.preventDefault(); a.openSaveForSave(); }
  });
}
