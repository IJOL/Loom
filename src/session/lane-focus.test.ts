// @vitest-environment jsdom
//
// focusLane is the ONE door. Every path that selects a lane goes through it,
// and the clip editor never ends up on a different lane than the knobs.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rollMock = vi.hoisted(() => ({ redraw: () => {}, getOctaveBase: () => 60, setOctaveBase: vi.fn() }));
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: () => rollMock,
}));
vi.mock('./clip-automation-lanes', () => ({ renderClipAutomationLanes: () => {} }));
vi.mock('./example-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./example-loader')>()),
  loadAllExamples: async () => [],
}));

import { SessionInspector } from './session-inspector';
import type { SessionHost } from './session-host';
import { focusLaneImpl } from './session-host';
import type { SessionState, SessionClip, SessionLane } from './session';
import { fakeDestinations } from './fake-destinations';

function mountDom(): void {
  document.body.innerHTML = `
    <div id="session-view-root">
      <div class="page" data-page="drums" hidden></div>
      <div class="page" data-page="instrument" hidden></div>
    </div>
    <div id="session-inspector" hidden>
      <div id="insp-context">
        <span id="insp-context-swatch"></span>
        <span id="insp-context-track"></span>
        <span id="insp-context-scene"></span>
        <span id="insp-context-row"></span>
      </div>
      <input id="insp-name" type="text" />
      <input id="insp-length" type="number" />
      <button id="insp-play"></button>
      <button id="insp-rec" hidden></button>
      <select id="insp-rec-mode" hidden></select>
      <button id="insp-tempo-double"></button>
      <button id="insp-tempo-halve"></button>
      <select id="insp-quantize"><option value=""></option></select>
      <button id="insp-duplicate"></button><button id="insp-delete"></button>
      <button id="insp-copy"></button>
      <button id="insp-paste-replace" disabled></button>
      <button id="insp-paste-layer" disabled></button>
      <button id="insp-random-notes"></button><button id="insp-variate"></button>
      <button id="insp-invert-melodic"></button><button id="insp-retrograde"></button>
      <button id="insp-chords"></button>
      <select id="insp-style-select"></select>
      <select id="insp-pattern-select"></select>
      <button id="insp-save-example"></button><button id="insp-export-example"></button>
      <button id="insp-toggle-editor"></button>
      <div id="insp-tonality"></div>
      <div id="insp-roll-host"></div>
    </div>`;
}

function clip(id: string, name: string): SessionClip {
  return { id, name, lengthBars: 2, notes: [] } as unknown as SessionClip;
}

function makeState(): SessionState {
  return {
    lanes: [
      { id: 'drums-1', engineId: 'drums-machine', name: 'Drums 1', clips: [clip('c-d0', 'Beat')] },
      { id: 'tb-303-1', engineId: 'tb303', name: 'Bass', clips: [clip('c-b0', 'Acid')] },
    ] as unknown as SessionLane[],
    scenes: [{ id: 's0', name: 'Drop', clipPerLane: {} }],
  } as unknown as SessionState;
}

function makeInspector(state: SessionState): SessionInspector {
  return new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: () => {},
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    destinations: fakeDestinations(),
    getAutoAbsSubIdx: () => 0,
  });
}

/** A SessionHost stub carrying only what focusLaneImpl reads.
 *
 *  `renderWithMixer` records the inspector's selection AS IT WAS at each call.
 *  The grid rings the open clip by reading that selection, so the last render of
 *  a lane switch has to see the NEW one — see the stale-ring test below. */
function makeSelf(
  state: SessionState,
  insp: SessionInspector,
  activeEditLane: string | null,
  renderLog?: (string | null)[],
): SessionHost {
  return {
    state,
    inspector: insp,
    activeEditLane,
    activeSceneIdx: -1,
    synthCollapsed: false,
    renderWithMixer: () => {
      const sel = insp.getSelectedClip();
      renderLog?.push(sel ? `${sel.laneId}#${sel.clipIdx}` : null);
    },
    deps: { onActiveLaneChanged: vi.fn(), setActiveEngineLane: vi.fn() },
  } as unknown as SessionHost;
}

const panel = () => document.getElementById('session-inspector') as HTMLElement;

describe('focusLane — the one door', () => {
  beforeEach(() => mountDom());

  it('never leaves the editor on a lane other than the selected one', () => {
    // The whole point. Whatever else happens, these two agree afterwards.
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
    insp.openInspector();
    expect(panel().hidden, 'precondition: the drums clip is open').toBe(false);

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(self.activeEditLane, 'the bass lane is now selected').toBe('tb-303-1');
    expect(insp.getSelectedClip()?.laneId ?? 'tb-303-1', 'and the editor is on it, or on nothing')
      .toBe('tb-303-1');
  });

  it('a clip announcing its own lane never closes the editor it just opened', () => {
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'tb-303-1', clipIdx: 0 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'clip');

    expect(insp.getSelectedClip(), 'the bass clip stays open').toEqual({ laneId: 'tb-303-1', clipIdx: 0 });
    expect(self.activeEditLane, 'the instrument page still follows').toBe('tb-303-1');
  });

  it('opens the new lane\'s clip in the same row', () => {
    // makeState already gives the bass lane a clip in row 0.
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(insp.getSelectedClip(), 'the bass clip in row 0 is now open')
      .toEqual({ laneId: 'tb-303-1', clipIdx: 0 });
    expect(panel().hidden, 'the editor stays open').toBe(false);
  });

  it('closes the editor and creates nothing when the row is empty', () => {
    const state = makeState();
    // Row 1 exists in drums only.
    (state.lanes[0] as unknown as { clips: SessionClip[] }).clips.push(clip('c-d1', 'Fill'));
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 1 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(insp.getSelectedClip(), 'nothing is open').toBeNull();
    expect(panel().hidden, 'the panel is hidden').toBe(true);
    expect(state.lanes[1].clips.length, 'no clip was created in the bass lane').toBe(1);
    expect(self.activeEditLane, 'the instrument page still switched').toBe('tb-303-1');
  });

  it('falls back to the launched scene\'s row when nothing is open', () => {
    const state = makeState();
    (state.lanes[0] as unknown as { clips: SessionClip[] }).clips.push(clip('c-d1', 'Fill'));
    const insp = makeInspector(state);

    const self = makeSelf(state, insp, 'tb-303-1');
    self.activeSceneIdx = 1;          // scene row 1 is launched
    focusLaneImpl(self, 'drums-1', 'lane');

    expect(insp.getSelectedClip(), 'the drums clip in the launched row opens')
      .toEqual({ laneId: 'drums-1', clipIdx: 1 });
  });

  it('repaints the grid AFTER the clip moves, so the ring is not left behind', () => {
    // Caught by looking, not by a test: the yellow "editing" border stayed on the
    // old lane's cell while the editor showed the new one. showLaneEditor
    // repaints the grid, and it runs BEFORE the clip decision — so the ring was
    // drawn from the outgoing selection and nothing repainted it afterwards.
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
    insp.openInspector();

    const renders: (string | null)[] = [];
    const self = makeSelf(state, insp, 'drums-1', renders);
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(renders.at(-1), 'the last repaint sees the clip that is actually open')
      .toBe('tb-303-1#0');
  });

  it('repaints the grid after CLOSING too, so no ring survives an empty row', () => {
    const state = makeState();
    (state.lanes[0] as unknown as { clips: SessionClip[] }).clips.push(clip('c-d1', 'Fill'));
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 1 });
    insp.openInspector();

    const renders: (string | null)[] = [];
    const self = makeSelf(state, insp, 'drums-1', renders);
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(renders.at(-1), 'the last repaint sees no open clip at all').toBeNull();
  });

  it('keeps the synth folded when it was folded, and re-points it underneath', () => {
    // The chevron's collapse is the user's choice about screen space, not about
    // which lane they are on. Changing lane used to unfold it every time.
    const state = makeState();
    const insp = makeInspector(state);
    const self = makeSelf(state, insp, 'drums-1');
    self.synthCollapsed = true;

    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(self.synthCollapsed, 'still folded').toBe(true);
    const pages = [...document.querySelectorAll<HTMLElement>('.page')];
    expect(pages.every((p) => p.hidden), 'no page is showing').toBe(true);
    expect(self.activeEditLane, 'but the selection did move underneath').toBe('tb-303-1');
  });

  it('shows the new lane\'s page when the synth was open', () => {
    const state = makeState();
    const insp = makeInspector(state);
    const self = makeSelf(state, insp, 'drums-1');
    self.synthCollapsed = false;

    focusLaneImpl(self, 'tb-303-1', 'lane');

    const shown = [...document.querySelectorAll<HTMLElement>('.page')]
      .filter((p) => !p.hidden).map((p) => p.dataset.page);
    expect(shown, 'the instrument page is the one showing').toEqual(['instrument']);
  });

  it('re-selecting the open clip\'s own lane leaves the editor alone', () => {
    // The chevron, an engine swap and an undo repaint all land here.
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'drums-1', 'lane');

    expect(panel().hidden).toBe(false);
    expect(insp.getSelectedClip()).toEqual({ laneId: 'drums-1', clipIdx: 0 });
  });
});
