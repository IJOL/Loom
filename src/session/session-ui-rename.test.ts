// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSessionGrid, _resetSceneClickStateForTesting, type SessionUICallbacks } from './session-ui';
import type { SessionState } from './session';
import type { LanePlayState } from './session-runtime';

// Scene single/double click is disambiguated via module-level timing state;
// clear it between tests so one test's click is never read as another's double.
beforeEach(() => _resetSceneClickStateForTesting());

export function makeState(): SessionState {
  return {
    lanes: [{ id: 'bass', engineId: 'tb303', name: 'BASS', clips: [{ id: 'c0', lengthBars: 1, notes: [] }] }],
    scenes: [{ id: 's0', name: 'Intro', clipPerLane: {} }],
    globalQuantize: '1/1',
  };
}

export function noopCallbacks(over: Partial<SessionUICallbacks> = {}): SessionUICallbacks {
  return {
    onClipClick() {}, onClipPlayPause() {}, onCellClick() {}, onMoveClip() {},
    onStopLane() {}, onLaunchScene() {}, onStopAll() {}, onAddScene() {}, onAddLane() {},
    onDuplicateLane() {}, onDuplicateScene() {}, onCaptureScene() {},
    onAddStemLanes() {}, onAddClipRow() {}, onEditLane() {}, onDeleteClip() {},
    onDeleteLane() {}, onDeleteScene() {}, onToggleDrumsExpanded() {},
    onToggleSynthEditor() {},
    ...over,
  };
}

describe('open-clip highlight', () => {
  it('rings exactly the open clip cell and tints its row', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map<string, LanePlayState>(), noopCallbacks(), { laneId: 'bass', clipIdx: 0 });
    const cell = host.querySelector('.session-cell[data-lane-id="bass"][data-clip-idx="0"]');
    expect(cell?.classList.contains('session-cell-editing')).toBe(true);
    expect(host.querySelectorAll('.session-cell-editing').length).toBe(1);
    expect(host.querySelectorAll('.session-row-editing').length).toBe(1);
  });

  it('rings nothing when no clip is open', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map<string, LanePlayState>(), noopCallbacks());
    expect(host.querySelectorAll('.session-cell-editing').length).toBe(0);
    expect(host.querySelectorAll('.session-row-editing').length).toBe(0);
  });
});

describe('grid in-place rename', () => {
  it('a quick second click on the lane header renames it', () => {
    const host = document.createElement('div');
    const onRenameLane = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onRenameLane }));
    const nameEl = host.querySelector('.session-lane-name') as HTMLElement;
    nameEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 1st → select
    nameEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 2nd (quick) → rename
    const input = host.querySelector('.inline-rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'Reese';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRenameLane).toHaveBeenCalledWith('bass', 'Reese');
  });

  it('a single click on a scene launches it immediately', () => {
    const host = document.createElement('div');
    const onLaunchScene = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onLaunchScene }));
    const nameEl = host.querySelector('.session-scene-name') as HTMLElement;
    nameEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onLaunchScene).toHaveBeenCalledWith(0);   // instant, no guard delay
  });

  it('a quick second click on a scene renames it (launches once, then edits)', () => {
    const host = document.createElement('div');
    const onLaunchScene = vi.fn();
    const onRenameScene = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onLaunchScene, onRenameScene }));
    const nameEl = host.querySelector('.session-scene-name') as HTMLElement;
    nameEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 1st → launch
    nameEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 2nd (quick) → rename
    expect(onLaunchScene).toHaveBeenCalledTimes(1);                     // only the first launched
    const input = host.querySelector('.inline-rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'Drop';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRenameScene).toHaveBeenCalledWith(0, 'Drop');
  });
});
