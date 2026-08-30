// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachPerfActions, type PerfActionDeps } from './perf-keys';

function makeDeps(sel: string[] = ['a']): PerfActionDeps {
  return {
    isActive: () => true,
    getSelection: () => new Set(sel),
    playheadSec: () => 3.5,
    deleteBands: vi.fn(),
    duplicateBands: vi.fn(),
    toggleMuteBands: vi.fn(),
    splitBandsAt: vi.fn(),
    copyBands: vi.fn(),
    pasteAtPlayhead: vi.fn(),
  };
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

describe('perf-keys', () => {
  let root: HTMLElement;
  let detach: () => void;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = '<div class="perf-clip" data-band-id="a"></div>';
    document.body.appendChild(root);
  });
  afterEach(() => { detach?.(); document.body.innerHTML = ''; });

  it('Delete removes the selection', () => {
    const deps = makeDeps();
    detach = attachPerfActions(root, deps);
    key('Delete');
    expect(deps.deleteBands).toHaveBeenCalledWith(new Set(['a']));
  });

  it('Ctrl+D duplicates; Ctrl+C copies; Ctrl+V pastes at the playhead', () => {
    const deps = makeDeps();
    detach = attachPerfActions(root, deps);
    key('d', { ctrlKey: true });
    expect(deps.duplicateBands).toHaveBeenCalledWith(new Set(['a']));
    key('c', { ctrlKey: true });
    expect(deps.copyBands).toHaveBeenCalledWith(new Set(['a']));
    key('v', { ctrlKey: true });
    expect(deps.pasteAtPlayhead).toHaveBeenCalledTimes(1);
  });

  it('does nothing while typing in an input or outside Performance', () => {
    const deps = makeDeps();
    detach = attachPerfActions(root, deps);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(deps.deleteBands).not.toHaveBeenCalled();

    detach();
    const inactive = { ...makeDeps(), isActive: () => false, deleteBands: vi.fn() };
    detach = attachPerfActions(root, inactive);
    key('Delete');
    expect(inactive.deleteBands).not.toHaveBeenCalled();
  });

  it('right-click on a band opens the menu; Split calls with the playhead second', () => {
    const deps = makeDeps();
    detach = attachPerfActions(root, deps);
    const band = root.querySelector('.perf-clip')!;
    band.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }));
    const menu = document.querySelector('.perf-context-menu')!;
    expect(menu).toBeTruthy();
    const items = [...menu.querySelectorAll('.perf-context-item')].map((el) => el.textContent);
    expect(items).toEqual(['Mute', 'Split at playhead', 'Duplicate', 'Delete']);
    (menu.querySelectorAll('.perf-context-item')[1] as HTMLElement).click();
    expect(deps.splitBandsAt).toHaveBeenCalledWith(new Set(['a']), 3.5);
    expect(document.querySelector('.perf-context-menu')).toBeNull(); // closed after use
  });

  it('a right-click on a band outside the selection acts on that band alone', () => {
    const deps = makeDeps(['other']);
    detach = attachPerfActions(root, deps);
    root.querySelector('.perf-clip')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    (document.querySelector('.perf-context-item') as HTMLElement).click(); // Mute
    expect(deps.toggleMuteBands).toHaveBeenCalledWith(new Set(['a']));
  });
});
