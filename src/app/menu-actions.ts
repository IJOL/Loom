// The contract the menu bar drives. Every method is a REAL function (from
// main.ts / returned handles) — never a synthetic DOM click.
export interface DemoItem { label: string; path: string; }

export interface MenuActions {
  newSession(): void;
  openSaveForSave(): void;
  openSaveForLoad(): void;
  openProjectOptions(): void;
  listDemos(): DemoItem[];
  loadDemo(path: string): void;
  openImportMidi(): void;
  openStems(): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  setMode(mode: 'session' | 'performance'): void;
  getMode(): 'session' | 'performance';
  togglePerfDiagnostics(): void;
  isPerfOpen(): boolean;

  openMidiController(): void;
  captureScene(): void;
  copyScenesToPerformance(): void;

  openManual(): void;
  openAbout(): void;
}
