import { describe, it, expect } from 'vitest';
import { buildMenus } from './menu-spec';
import type { MenuActions } from './menu-actions';

function stubActions(over: Partial<MenuActions> = {}): MenuActions {
  const noop = () => {};
  return {
    newSession: noop, openSaveForSave: noop, openSaveForLoad: noop, openProjectOptions: noop,
    listDemos: () => [{ label: 'Acid Rain', path: '/demos/acid.json' }], loadDemo: noop,
    openImportMidi: noop, openStems: noop,
    undo: noop, redo: noop, canUndo: () => false, canRedo: () => false,
    setMode: noop, getMode: () => 'session', togglePerfDiagnostics: noop, isPerfOpen: () => false,
    openMidiController: noop, captureScene: noop, copyScenesToPerformance: noop,
    openManual: noop, openAbout: noop, ...over,
  };
}

describe('buildMenus', () => {
  it('produces the five top-level menus in order', () => {
    const labels = buildMenus(stubActions()).map((m) => m.label);
    expect(labels).toEqual(['File', 'Edit', 'View', 'Tools', 'Help']);
  });

  it('File contains Project Options, Import MIDI, Stems and a disabled Preferences', () => {
    const file = buildMenus(stubActions()).find((m) => m.label === 'File')!;
    const items = file.items.filter((i): i is Exclude<typeof i, 'divider'> => i !== 'divider');
    const byLabel = (l: string) => items.find((i) => i.label.startsWith(l))!;
    expect(byLabel('Project Options')).toBeTruthy();
    expect(byLabel('Import MIDI')).toBeTruthy();
    expect(byLabel('Separate into Stems')).toBeTruthy();
    expect(byLabel('Preferences').enabled!()).toBe(false);  // Part 2
  });

  it('View ▸ Session is checked when getMode() === session', () => {
    const view = buildMenus(stubActions({ getMode: () => 'session' })).find((m) => m.label === 'View')!;
    const session = view.items.filter((i) => i !== 'divider').find((i: any) => i.label === 'Session') as any;
    expect(session.checked()).toBe(true);
  });

  it('running a menu item invokes the matching action', () => {
    let called = false;
    const file = buildMenus(stubActions({ captureScene: () => { called = true; } }));
    const tools = file.find((m) => m.label === 'Tools')!;
    const capture = tools.items.filter((i) => i !== 'divider').find((i: any) => i.label.startsWith('Capture')) as any;
    capture.run();
    expect(called).toBe(true);
  });

  it('the Open Demo submenu is built from listDemos()', () => {
    const file = buildMenus(stubActions()).find((m) => m.label === 'File')!;
    const demo = file.items.filter((i) => i !== 'divider').find((i: any) => i.label.startsWith('Open Demo')) as any;
    expect(demo.submenu!()).toHaveLength(1);
    expect(demo.submenu!()[0].label).toBe('Acid Rain');
  });
});
