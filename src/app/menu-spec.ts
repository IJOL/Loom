import type { MenuActions } from './menu-actions';

export interface MenuItemSpec {
  label: string;
  shortcut?: string;            // display only (accelerators bound separately)
  enabled?: () => boolean;      // default true
  checked?: () => boolean;      // checkable items
  run?: () => void;             // action (omitted → non-interactive)
  submenu?: () => MenuItemSpec[];
}
export interface MenuSpec { label: string; items: (MenuItemSpec | 'divider')[]; }

export function buildMenus(a: MenuActions): MenuSpec[] {
  return [
    { label: 'File', items: [
      { label: 'New Session', shortcut: 'Ctrl+N', run: a.newSession },
      { label: 'Open…', shortcut: 'Ctrl+O', run: a.openSaveForLoad },
      { label: 'Save', shortcut: 'Ctrl+S', run: a.openSaveForSave },
      { label: 'Save As…', run: a.openSaveForSave },
      'divider',
      { label: 'Project Options…', run: a.openProjectOptions },
      { label: 'Open Demo', submenu: () => a.listDemos().map((d) => ({ label: d.label, run: () => a.loadDemo(d.path) })) },
      'divider',
      { label: 'Import MIDI…', run: a.openImportMidi },
      { label: 'Separate into Stems…', run: a.openStems },
      'divider',
      { label: 'Preferences…', shortcut: 'Ctrl+,', enabled: () => false },   // Part 2
    ]},
    { label: 'Edit', items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', enabled: a.canUndo, run: a.undo },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', enabled: a.canRedo, run: a.redo },
    ]},
    { label: 'View', items: [
      { label: 'Session', checked: () => a.getMode() === 'session', run: () => a.setMode('session') },
      { label: 'Performance', checked: () => a.getMode() === 'performance', run: () => a.setMode('performance') },
      'divider',
      { label: 'Performance diagnostics (PERF)', checked: a.isPerfOpen, run: a.togglePerfDiagnostics },
    ]},
    { label: 'Tools', items: [
      { label: 'MIDI Controller…', run: a.openMidiController },
      { label: 'Capture Scene', shortcut: 'Ctrl+I', run: a.captureScene },
      { label: 'Copy Scenes → Performance', run: a.copyScenesToPerformance },
    ]},
    { label: 'Help', items: [
      { label: 'Manual ↗', run: a.openManual },
      { label: 'About Loom', run: a.openAbout },
    ]},
  ];
}
