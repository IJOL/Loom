// @vitest-environment jsdom
// Clip drag gesture lifecycle. The regression under test: the gesture's
// pointerup used to be a CELL listener, so a release that landed anywhere else
// (the grid gap, a ▶/✕ child that stopPropagation()s, or a cell discarded by a
// mid-gesture grid re-render) never ended the gesture — the stale module state
// then resurrected on plain hover as a ghost glued to a button-less cursor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderSessionGrid, _resetSceneClickStateForTesting } from './session-ui';
import { makeState, noopCallbacks } from './session-ui-rename.test';
import type { SessionState } from './session';
import type { LanePlayState } from './session-runtime';

// jsdom lacks pointer capture; harmless for the window-level gesture listeners
// but must not throw if an implementation calls it.
(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture ??= () => {};
(Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??= () => {};

/** makeState + a second scene so row 2 renders an EMPTY bass cell (drop target). */
function makeStateTwoRows(): SessionState {
  const s = makeState();
  s.scenes.push({ id: 's1', name: 'Verse', clipPerLane: {} });
  return s;
}

const realElementFromPoint = document.elementFromPoint;
let host: HTMLElement;

beforeEach(() => {
  _resetSceneClickStateForTesting();
  host = document.createElement('div');
  document.body.appendChild(host);   // window-level listeners need a connected tree
});

afterEach(() => {
  // End any gesture a failing run left behind, then scrub the DOM.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.session-ghost').forEach((g) => g.remove());
  document.body.className = '';
  host.remove();
  (document as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint = realElementFromPoint;
});

function render(cb = noopCallbacks(), state = makeStateTwoRows()) {
  renderSessionGrid(host, state, new Map<string, LanePlayState>(), cb);
  return state;
}

function filledCell(): HTMLElement {
  return host.querySelector('.session-cell-filled[data-lane-id="bass"][data-clip-idx="0"]') as HTMLElement;
}

function pev(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, ...init });
}

describe('clip drag gesture', () => {
  it('a plain click on the clip body opens it and leaves no ghost', () => {
    const onClipClick = vi.fn();
    render(noopCallbacks({ onClipClick }));
    const cell = filledCell();
    cell.dispatchEvent(pev('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    cell.dispatchEvent(pev('pointerup', { clientX: 11, clientY: 10 }));
    expect(onClipClick).toHaveBeenCalledExactlyOnceWith('bass', 0);
    expect(document.querySelectorAll('.session-ghost').length).toBe(0);
  });

  it('dragging past the threshold and releasing over an empty slot moves the clip', () => {
    const onMoveClip = vi.fn();
    render(noopCallbacks({ onMoveClip }));
    const cell = filledCell();
    const target = host.querySelector('.session-cell-empty[data-lane-id="bass"][data-clip-idx="1"]') as HTMLElement;
    expect(target).toBeTruthy();
    (document as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint = () => target;

    cell.dispatchEvent(pev('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    cell.dispatchEvent(pev('pointermove', { buttons: 1, clientX: 10, clientY: 60 }));
    expect(document.querySelectorAll('.session-ghost').length).toBe(1);
    // The release lands on the TARGET cell, not the source — must still finish.
    document.body.dispatchEvent(pev('pointerup', { clientX: 10, clientY: 60 }));

    expect(onMoveClip).toHaveBeenCalledExactlyOnceWith(
      { laneId: 'bass', clipIdx: 0 }, { laneId: 'bass', clipIdx: 1 }, false);
    expect(document.querySelectorAll('.session-ghost').length).toBe(0);
    expect(document.querySelectorAll('.drop-source, .drop-valid, .drop-invalid').length).toBe(0);
  });

  it('Escape cancels an active drag without clicking or moving anything', () => {
    const onMoveClip = vi.fn();
    const onClipClick = vi.fn();
    render(noopCallbacks({ onMoveClip, onClipClick }));
    const cell = filledCell();
    (document as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint = () => null;

    cell.dispatchEvent(pev('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    cell.dispatchEvent(pev('pointermove', { buttons: 1, clientX: 10, clientY: 60 }));
    expect(document.querySelectorAll('.session-ghost').length).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelectorAll('.session-ghost').length).toBe(0);
    document.body.dispatchEvent(pev('pointerup', { clientX: 10, clientY: 60 }));
    expect(onMoveClip).not.toHaveBeenCalled();
    expect(onClipClick).not.toHaveBeenCalled();
  });

  // THE reported bug: click a clip, the release lands off the cell (gap /
  // stopPropagation child / re-rendered cell) — moving the mouse afterwards
  // grew a ghost that followed the cursor with no button held.
  it('a release outside the cell ends the gesture — later hover grows no ghost', () => {
    const onClipClick = vi.fn();
    render(noopCallbacks({ onClipClick }));
    const cell = filledCell();
    (document as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint = () => null;

    cell.dispatchEvent(pev('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    document.body.dispatchEvent(pev('pointerup', { clientX: 12, clientY: 10 }));   // off-cell release
    // Sub-threshold release is still a click on the pressed clip.
    expect(onClipClick).toHaveBeenCalledExactlyOnceWith('bass', 0);

    cell.dispatchEvent(pev('pointermove', { buttons: 0, clientX: 60, clientY: 60 }));   // plain hover
    expect(document.querySelectorAll('.session-ghost').length).toBe(0);
    expect(document.body.classList.contains('drag-copy')).toBe(false);
  });

  it('a grid re-render mid-gesture does not strand the drag on hover', () => {
    const cb = noopCallbacks();
    const state = render(cb);
    const cell = filledCell();
    (document as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint = () => null;

    cell.dispatchEvent(pev('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    renderSessionGrid(host, state, new Map<string, LanePlayState>(), cb);   // discards the pressed cell
    const freshCell = filledCell();
    expect(freshCell).not.toBe(cell);
    // The up never reached any cell; a button-less move must not start a drag.
    freshCell.dispatchEvent(pev('pointermove', { buttons: 0, clientX: 60, clientY: 60 }));
    expect(document.querySelectorAll('.session-ghost').length).toBe(0);
  });
});
