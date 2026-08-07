import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerPanel, unregisterPanel, listPanels, clearPanels, registerPanelMount } from './panel-registry';

const entry = (id: string, name = id) =>
  ({ id, name, placement: 'main-view' as const, params: [] });

describe('panel registry', () => {
  beforeEach(() => { clearPanels(); });

  it('lists a registered panel', () => {
    registerPanel(entry('weave', 'Weave'));
    expect(listPanels().map((p) => p.id)).toEqual(['weave']);
  });

  it('starts empty', () => {
    expect(listPanels()).toHaveLength(0);
  });

  it('keeps the first registration when an id repeats, and says so', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPanel(entry('weave', 'First'));
    registerPanel(entry('weave', 'Second'));
    expect(listPanels()).toHaveLength(1);
    expect(listPanels()[0].name).toBe('First');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('forgets a panel that unregisters, so unloading a plugin is clean', () => {
    registerPanel(entry('weave'));
    unregisterPanel('weave');
    expect(listPanels()).toHaveLength(0);
  });

  it('lists several panels in registration order', () => {
    registerPanel(entry('weave'));
    registerPanel(entry('other'));
    expect(listPanels().map((p) => p.id)).toEqual(['weave', 'other']);
  });
});

// The manifest declares a panel; main.js says how to draw it. Same two-halves
// arrival an fx already has, for the same reason: a function cannot be JSON.
describe('the mount half', () => {
  beforeEach(() => { clearPanels(); });

  it('has no mount until main.js delivers one', () => {
    registerPanel(entry('weave'));
    expect(listPanels()[0].mount).toBeUndefined();
  });

  it('takes the mount main.js delivers', () => {
    registerPanel(entry('weave'));
    const mount = () => () => {};
    registerPanelMount('weave', mount);
    expect(listPanels()[0].mount).toBe(mount);
  });

  it('refuses a mount for a panel the manifest never declared', () => {
    // Otherwise a plugin could put a panel on screen having passed no
    // validation at all.
    expect(() => registerPanelMount('ghost', () => () => {}))
      .toThrow(/never declared a panel component/);
  });

  it('refuses a second mount for the same id', () => {
    registerPanel(entry('weave'));
    registerPanelMount('weave', () => () => {});
    expect(() => registerPanelMount('weave', () => () => {}))
      .toThrow(/at most once per id/);
  });
});
