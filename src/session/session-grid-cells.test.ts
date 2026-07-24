// @vitest-environment jsdom
// Characterisation for the clip-cell / stop-row interactions the lit-html
// migration rewired from addEventListener to template bindings. Structure
// (classes, data-attrs) is covered by session-ui-rename/-reorder; this file
// pins the cell-level behaviors that had no coverage: the play icon, the ✕
// crosses, the drag-click fallback, and lit patching cells in place.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSessionGrid, _resetSceneClickStateForTesting } from './session-ui';
import { makeState, noopCallbacks } from './session-ui-rename.test';
import type { LanePlayState } from './session-runtime';

beforeEach(() => _resetSceneClickStateForTesting());

const click = () => new MouseEvent('click', { bubbles: true });

describe('clip cell interactions', () => {
  it('▶ icon click plays/stops the clip WITHOUT opening the editor', () => {
    const host = document.createElement('div');
    const onClipPlayPause = vi.fn();
    const onClipClick = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onClipPlayPause, onClipClick }));
    (host.querySelector('.session-cell-play') as HTMLElement).dispatchEvent(click());
    expect(onClipPlayPause).toHaveBeenCalledWith('bass', 0);
    expect(onClipClick).not.toHaveBeenCalled();
  });

  it('a plain pointerdown+up on the clip body opens the editor (drag-click fallback)', () => {
    const host = document.createElement('div');
    // The gesture's up/cancel listeners live on window (capture) — the host
    // must be IN the document or the cell's pointerup never propagates there.
    document.body.appendChild(host);
    try {
      const onClipClick = vi.fn();
      renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onClipClick }));
      const cell = host.querySelector('.session-cell-filled') as HTMLElement;
      // jsdom has no PointerEvent; MouseEvent carries the same fields the
      // handlers read (button, clientX/Y, pointerId undefined on both sides).
      cell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      expect(onClipClick).toHaveBeenCalledWith('bass', 0);
    } finally {
      host.remove();
    }
  });

  it('the clip ✕ deletes without triggering the cell click', () => {
    const host = document.createElement('div');
    const onDeleteClip = vi.fn();
    const onClipClick = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onDeleteClip, onClipClick }));
    const cross = host.querySelector('.session-cell-filled .session-del-cross') as HTMLElement;
    cross.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    cross.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    cross.dispatchEvent(click());
    expect(onDeleteClip).toHaveBeenCalledWith('bass', 0);
    expect(onClipClick).not.toHaveBeenCalled();
  });

  it('an empty cell click creates/opens via onCellClick', () => {
    const host = document.createElement('div');
    const onCellClick = vi.fn();
    const state = makeState();
    state.scenes.push({ id: 's1', name: 'Verse', clipPerLane: {} }); // row 1 has no clip → empty cell
    renderSessionGrid(host, state, new Map(), noopCallbacks({ onCellClick }));
    const empty = host.querySelector('.session-cell-empty[data-clip-idx="1"]') as HTMLElement;
    empty.dispatchEvent(click());
    expect(onCellClick).toHaveBeenCalledWith('bass', 1);
  });
});

describe('stop row + add-scene', () => {
  it('per-lane ⏹ stops that lane; ⏹ all stops everything; + adds a scene', () => {
    const host = document.createElement('div');
    const onStopLane = vi.fn();
    const onStopAll = vi.fn();
    const onAddScene = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onStopLane, onStopAll, onAddScene }));
    (host.querySelector('.session-lane-stop') as HTMLElement).dispatchEvent(click());
    expect(onStopLane).toHaveBeenCalledWith('bass');
    (host.querySelector('.session-stop-all') as HTMLElement).dispatchEvent(click());
    expect(onStopAll).toHaveBeenCalledTimes(1);
    (host.querySelector('.session-add-scene') as HTMLElement).dispatchEvent(click());
    expect(onAddScene).toHaveBeenCalledTimes(1);
  });
});

describe('lit re-render patches in place', () => {
  it('a play-state change updates the SAME cell element (marker class + ⏸ icon)', () => {
    const host = document.createElement('div');
    const state = makeState();
    const cb = noopCallbacks();
    renderSessionGrid(host, state, new Map(), cb);
    const cell = host.querySelector('.session-cell-filled') as HTMLElement;
    expect(cell.classList.contains('session-cell-playing')).toBe(false);

    const laneStates = new Map<string, LanePlayState>([
      ['bass', { playing: state.lanes[0].clips[0], queued: null, queuedStop: null } as unknown as LanePlayState],
    ]);
    renderSessionGrid(host, state, laneStates, cb);
    const cellAfter = host.querySelector('.session-cell-filled') as HTMLElement;
    expect(cellAfter).toBe(cell); // patched, not rebuilt — drags/hover survive repaints
    expect(cellAfter.classList.contains('session-cell-playing')).toBe(true);
    expect((cellAfter.querySelector('.session-cell-play') as HTMLElement).textContent).toBe('⏸');
  });

  it('exposes the (empty) mixer row to the host via cb._mixerRow', () => {
    const host = document.createElement('div');
    const cb = noopCallbacks();
    renderSessionGrid(host, makeState(), new Map(), cb);
    expect(cb._mixerRow?.classList.contains('session-row-mixer')).toBe(true);
    // Imperative children (mixer strips) must survive a lit repaint.
    const marker = document.createElement('span');
    cb._mixerRow!.appendChild(marker);
    renderSessionGrid(host, makeState(), new Map(), cb);
    expect(cb._mixerRow!.contains(marker)).toBe(true);
  });
});
