// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SessionInspector } from './session-inspector';

// renderEditor is canvas-bound; stub the router so refreshOpenEditor is observable.
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: vi.fn(() => null),
}));
vi.mock('./clip-automation-lanes', () => ({ renderClipAutomationLanes: () => {} }));

import { renderClipEditor } from './clip-editors/clip-editor-router';

describe('SessionInspector.refreshOpenEditor', () => {
  it('re-renders the editor when the panel is open and a clip is selected', () => {
    document.body.innerHTML = `<div id="session-inspector"></div><div id="insp-editor"></div><div id="insp-roll-host"></div>`;
    const panel = document.getElementById('session-inspector')!;
    panel.hidden = false;
    const state = { lanes: [{ id: 'l1', engineId: 'tb303', clips: [{ id: 'c1', lengthBars: 1, notes: [] }], name: 'L1' }], scenes: [] } as never;
    const insp = new SessionInspector({
      ctx: {} as never, seq: { meter: '4/4', bpm: 120 } as never, state,
      laneStates: new Map(), renderWithMixer: () => {}, midiLabel: (m: number) => String(m),
      automationRegistry: new Map(), getAutoAbsSubIdx: () => 0,
    } as never);
    insp.setSelectedClip({ laneId: 'l1', clipIdx: 0 });
    (renderClipEditor as ReturnType<typeof vi.fn>).mockClear();
    insp.refreshOpenEditor();
    expect(renderClipEditor).toHaveBeenCalledOnce();
  });

  it('does nothing when the panel is hidden', () => {
    document.body.innerHTML = `<div id="session-inspector" hidden></div><div id="insp-editor"></div>`;
    const state = { lanes: [], scenes: [] } as never;
    const insp = new SessionInspector({
      ctx: {} as never, seq: { meter: '4/4', bpm: 120 } as never, state,
      laneStates: new Map(), renderWithMixer: () => {}, midiLabel: (m: number) => String(m),
      automationRegistry: new Map(), getAutoAbsSubIdx: () => 0,
    } as never);
    (renderClipEditor as ReturnType<typeof vi.fn>).mockClear();
    insp.refreshOpenEditor();
    expect(renderClipEditor).not.toHaveBeenCalled();
  });
});
