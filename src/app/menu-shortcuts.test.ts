// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { registerMenuShortcuts } from './menu-shortcuts';

function fireCtrl(key: string, opts: { target?: EventTarget } = {}): void {
  const target = opts.target ?? window;
  const e = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true });
  target.dispatchEvent(e);
}

describe('registerMenuShortcuts', () => {
  it('Ctrl+S calls openSaveForSave', () => {
    const openSaveForSave = vi.fn();
    registerMenuShortcuts({ newSession: vi.fn(), openSaveForLoad: vi.fn(), openSaveForSave });
    fireCtrl('s');
    expect(openSaveForSave).toHaveBeenCalledOnce();
  });

  it('Ctrl+N calls newSession', () => {
    const newSession = vi.fn();
    registerMenuShortcuts({ newSession, openSaveForLoad: vi.fn(), openSaveForSave: vi.fn() });
    fireCtrl('n');
    expect(newSession).toHaveBeenCalledOnce();
  });

  it('Ctrl+S dispatched with target inside an <input> does NOT fire', () => {
    const openSaveForSave = vi.fn();
    registerMenuShortcuts({ newSession: vi.fn(), openSaveForLoad: vi.fn(), openSaveForSave });
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    fireCtrl('s', { target: input });
    expect(openSaveForSave).not.toHaveBeenCalled();
    input.remove();
  });

  it('a bare "s" (no ctrl/meta) does nothing', () => {
    const openSaveForSave = vi.fn();
    registerMenuShortcuts({ newSession: vi.fn(), openSaveForLoad: vi.fn(), openSaveForSave });
    const e = new KeyboardEvent('keydown', { key: 's', bubbles: true });
    window.dispatchEvent(e);
    expect(openSaveForSave).not.toHaveBeenCalled();
  });
});
