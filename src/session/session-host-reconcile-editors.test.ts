// @vitest-environment jsdom
//
// Regression: after "New" (or a stem "Replace", a demo/save load), the open
// editors stayed mounted pointing at a lane/clip that no longer exists — the
// synth-lane editor page stayed visible showing the old lane, and the clip
// inspector stayed open. applyLoadedSessionState only swapped state + repainted
// the grid; it never reconciled the open editors. reconcileOpenEditors closes
// the synth editor when its lane is gone and the clip inspector when its clip is
// gone.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reconcileOpenEditors } from './session-host-persistence';
import type { SessionHost } from './session-host';

function mountDom(): void {
  document.body.innerHTML = `
    <div id="session-view-root">
      <div class="page" data-page="303" hidden></div>
      <div class="page" data-page="drums" hidden></div>
      <div class="page" data-page="poly"></div>
    </div>
    <div id="engine-lane-label">Sub 1</div>
    <div id="session-inspector"></div>
  `;
}

function makeSelf(over: Partial<SessionHost> & { state: { lanes: unknown[] } }): SessionHost {
  return {
    onActiveLaneChanged: undefined,
    deps: { onActiveLaneChanged: vi.fn() },
    ...over,
  } as unknown as SessionHost;
}

describe('reconcileOpenEditors — close orphaned editors after a state swap', () => {
  beforeEach(() => mountDom());

  it('closes the synth-lane editor when the edited lane no longer exists', () => {
    const onActiveLaneChanged = vi.fn();
    const self = makeSelf({
      state: { lanes: [] },               // New ⇒ no lanes
      activeEditLane: 'subtractive-1',
      inspector: { getSelectedClip: () => null, closeInspector: vi.fn() },
      deps: { onActiveLaneChanged },
    } as unknown as Partial<SessionHost> & { state: { lanes: unknown[] } });

    reconcileOpenEditors(self);

    expect(self.activeEditLane, 'activeEditLane is cleared').toBeNull();
    expect(
      (document.querySelector('.page[data-page="poly"]') as HTMLElement).hidden,
      'the visible synth editor page is hidden',
    ).toBe(true);
    expect(onActiveLaneChanged).toHaveBeenCalled();
  });

  it('closes the clip inspector when the selected clip no longer exists', () => {
    const closeInspector = vi.fn();
    const self = makeSelf({
      state: { lanes: [{ id: 'subtractive-1', engineId: 'subtractive', clips: [] }] },
      activeEditLane: 'subtractive-1',
      inspector: {
        getSelectedClip: () => ({ laneId: 'subtractive-1', clipIdx: 3 }), // clip gone
        closeInspector,
      },
      deps: { onActiveLaneChanged: vi.fn() },
    } as unknown as Partial<SessionHost> & { state: { lanes: unknown[] } });

    reconcileOpenEditors(self);

    expect(closeInspector, 'inspector closed when its clip is gone').toHaveBeenCalled();
  });

  it('leaves editors alone when the lane and clip still exist', () => {
    const closeInspector = vi.fn();
    const onActiveLaneChanged = vi.fn();
    const self = makeSelf({
      state: { lanes: [{ id: 'subtractive-1', engineId: 'subtractive', clips: [{ id: 'c1' }] }] },
      activeEditLane: 'subtractive-1',
      inspector: {
        getSelectedClip: () => ({ laneId: 'subtractive-1', clipIdx: 0 }),
        closeInspector,
      },
      deps: { onActiveLaneChanged },
    } as unknown as Partial<SessionHost> & { state: { lanes: unknown[] } });

    reconcileOpenEditors(self);

    expect(self.activeEditLane).toBe('subtractive-1');
    expect((document.querySelector('.page[data-page="poly"]') as HTMLElement).hidden).toBe(false);
    expect(closeInspector).not.toHaveBeenCalled();
  });
});
