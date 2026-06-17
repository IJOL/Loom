// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderSessionGrid, type SessionUICallbacks } from './session-ui';
import type { SessionState } from './session';
import type { LanePlayState } from './session-runtime';

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
    onAddStemLanes() {}, onAddClipRow() {}, onEditLane() {}, onDeleteClip() {},
    onDeleteLane() {}, onDeleteScene() {}, onToggleDrumsExpanded() {},
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
