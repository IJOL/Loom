// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openContextMenu, closeContextMenu } from './context-menu';

beforeEach(() => { closeContextMenu(); document.body.innerHTML = ''; });

function ctxEvent(x = 10, y = 20) {
  return { clientX: x, clientY: y, preventDefault: vi.fn(), target: document.body } as unknown as MouseEvent;
}

describe('context menu', () => {
  it('opens a positioned <ul> and calls preventDefault', () => {
    const e = ctxEvent(30, 40);
    openContextMenu(e, [{ label: 'A', onSelect: () => {} }]);
    const ul = document.querySelector('.context-menu') as HTMLElement;
    expect(ul).not.toBeNull();
    expect(ul.style.left).toBe('30px');
    expect(ul.style.top).toBe('40px');
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('item click fires onSelect and closes', () => {
    const onSelect = vi.fn();
    openContextMenu(ctxEvent(), [{ label: 'Go', onSelect }]);
    (document.querySelector('.context-menu-item') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('disabled item is marked and does not fire (menu stays open)', () => {
    const onSelect = vi.fn();
    openContextMenu(ctxEvent(), [{ label: 'No', onSelect, disabled: true }]);
    const item = document.querySelector('.context-menu-item') as HTMLElement;
    expect(item.classList.contains('disabled')).toBe(true);
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('.context-menu')).not.toBeNull();
  });

  it('danger class + separatorBefore render', () => {
    openContextMenu(ctxEvent(), [
      { label: 'Edit', onSelect: () => {} },
      { label: 'Delete', onSelect: () => {}, danger: true, separatorBefore: true },
    ]);
    expect(document.querySelector('.context-menu-sep')).not.toBeNull();
    const items = document.querySelectorAll('.context-menu-item');
    expect((items[1] as HTMLElement).classList.contains('danger')).toBe(true);
  });

  it('swatch row renders one button per colour, marks current, and picks + closes', () => {
    const onPick = vi.fn();
    openContextMenu(ctxEvent(), [
      { label: 'Open', onSelect: () => {} },
      { label: 'Color', separatorBefore: true, swatches: { colors: ['#aaa', '#bbb', '#ccc'], current: '#bbb', onPick } },
    ]);
    const swatches = document.querySelectorAll('.context-menu-swatch');
    expect(swatches.length).toBe(3);
    expect((swatches[1] as HTMLElement).classList.contains('current')).toBe(true);
    (swatches[2] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('#ccc');
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('Escape closes the menu', () => {
    openContextMenu(ctxEvent(), [{ label: 'A', onSelect: () => {} }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('outside pointerdown closes the menu', () => {
    openContextMenu(ctxEvent(), [{ label: 'A', onSelect: () => {} }]);
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('opening a second menu closes the first (singleton)', () => {
    openContextMenu(ctxEvent(), [{ label: 'A', onSelect: () => {} }]);
    openContextMenu(ctxEvent(), [{ label: 'B', onSelect: () => {} }]);
    expect(document.querySelectorAll('.context-menu').length).toBe(1);
  });
});
