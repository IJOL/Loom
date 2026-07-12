// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSessionGrid, _resetSceneClickStateForTesting } from './session-ui';
import { makeState, noopCallbacks } from './session-ui-rename.test';
import type { LanePlayState } from './session-runtime';

beforeEach(() => _resetSceneClickStateForTesting());

describe('column header as lane selector', () => {
  it('a single click on the lane header edits that lane', () => {
    const host = document.createElement('div');
    const onEditLane = vi.fn();
    renderSessionGrid(host, makeState(), new Map<string, LanePlayState>(), noopCallbacks({ onEditLane }));
    const header = host.querySelector('.session-lane-header[data-lane-id="bass"]') as HTMLElement;
    header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onEditLane).toHaveBeenCalledWith('bass');
  });

  it('marks the active lane header + its clip cells', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks(), undefined, { activeEditLane: 'bass' });
    const header = host.querySelector('.session-lane-header[data-lane-id="bass"]') as HTMLElement;
    expect(header.classList.contains('session-lane-header-active')).toBe(true);
    const cell = host.querySelector('.session-cell[data-lane-id="bass"][data-clip-idx="0"]') as HTMLElement;
    expect(cell.classList.contains('session-cell-col-active')).toBe(true);
  });

  it('marks no header when there is no active lane', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks());
    expect(host.querySelectorAll('.session-lane-header-active').length).toBe(0);
    expect(host.querySelectorAll('.session-cell-col-active').length).toBe(0);
  });
});

describe('synth collapse chevron', () => {
  it('shows a chevron only on the active header and toggles via onToggleSynthEditor', () => {
    const host = document.createElement('div');
    const onToggleSynthEditor = vi.fn();
    const onEditLane = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onToggleSynthEditor, onEditLane }), undefined, { activeEditLane: 'bass' });
    const chevron = host.querySelector('.session-lane-header-active .session-lane-collapse') as HTMLButtonElement;
    expect(chevron).toBeTruthy();
    expect(chevron.textContent).toBe('▾');
    chevron.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleSynthEditor).toHaveBeenCalledTimes(1);
    expect(onEditLane).not.toHaveBeenCalled(); // chevron must not also select
  });

  it('shows ▸ when the synth is collapsed', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks(), undefined, { activeEditLane: 'bass', synthCollapsed: true });
    const chevron = host.querySelector('.session-lane-collapse') as HTMLButtonElement;
    expect(chevron.textContent).toBe('▸');
  });

  it('renders no chevron on inactive headers', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks(), undefined, { activeEditLane: null });
    expect(host.querySelectorAll('.session-lane-collapse').length).toBe(0);
  });
});
