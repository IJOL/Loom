import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerPanel, unregisterPanel, listPanels, clearPanels } from './panel-registry';

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
