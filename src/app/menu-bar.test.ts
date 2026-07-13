// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createMenuBar } from './menu-bar';
import type { MenuSpec } from './menu-spec';

function menus(onRun: (l: string) => void): MenuSpec[] {
  return [
    { label: 'File', items: [
      { label: 'New Session', shortcut: 'Ctrl+N', run: () => onRun('New Session') },
      'divider',
      { label: 'Preferences…', enabled: () => false },
    ]},
    { label: 'Edit', items: [ { label: 'Undo', enabled: () => false, run: () => onRun('Undo') } ]},
  ];
}

describe('createMenuBar', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });

  it('renders one top-level label per menu', () => {
    createMenuBar(host, menus(() => {}));
    const labels = Array.from(host.querySelectorAll('.menubar-top')).map((e) => e.textContent);
    expect(labels).toEqual(['File', 'Edit']);
  });

  it('clicking a top label opens its dropdown; clicking an item runs it and closes', () => {
    const runs: string[] = [];
    createMenuBar(host, menus((l) => runs.push(l)));
    (host.querySelector('.menubar-top') as HTMLElement).click();   // open File
    expect(host.querySelector('.menubar-dropdown')).toBeTruthy();
    const item = Array.from(host.querySelectorAll('.menubar-item')).find((e) => e.textContent!.includes('New Session')) as HTMLElement;
    item.click();
    expect(runs).toEqual(['New Session']);
    expect(host.querySelector('.menubar-dropdown')).toBeFalsy();   // closed after run
  });

  it('a disabled item does not run and carries the disabled class', () => {
    const runs: string[] = [];
    createMenuBar(host, menus((l) => runs.push(l)));
    (host.querySelector('.menubar-top') as HTMLElement).click();
    const pref = Array.from(host.querySelectorAll('.menubar-item')).find((e) => e.textContent!.includes('Preferences')) as HTMLElement;
    expect(pref.classList.contains('is-disabled')).toBe(true);
    pref.click();
    expect(runs).toEqual([]);
  });
});
