// @vitest-environment jsdom
//
// "cuando se cambia de lane debería cerrarse el clip si no es del lane clickeado"
//
// Selecting another lane while a clip editor was open left the two disagreeing:
// the grid marked lane B active while the editor still showed — and edited,
// generated into, and played — lane A's clip. Root cause: TWO functions set the
// active lane, and only one told the inspector. focusLane() (the clip-open + APC
// path) is announced; showLaneEditor() — what the lane HEADER click reaches via
// onEditLane — set activeEditLane directly and never consulted the open selection.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Same stubs as session-inspector.test.ts: the canvas editor + automation lanes
// are unsafe under jsdom; examples must not fetch.
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

import { shouldCloseClipEditorOnLaneSwitch } from './session-host-util';
import { SessionInspector } from './session-inspector';
import { showLaneEditor } from './session-host-lane-editor';
import type { SessionHost } from './session-host';
import type { SessionState, SessionClip, SessionLane } from './session';

// ── The decision, on its own ───────────────────────────────────────────────

describe('shouldCloseClipEditorOnLaneSwitch', () => {
  it('closes when the open clip belongs to another lane', () => {
    expect(shouldCloseClipEditorOnLaneSwitch({ laneId: 'drums-1' }, 'tb-303-1')).toBe(true);
  });

  it('keeps the editor open when the selected lane owns the open clip', () => {
    expect(shouldCloseClipEditorOnLaneSwitch({ laneId: 'drums-1' }, 'drums-1')).toBe(false);
  });

  it('does nothing when no clip is open', () => {
    expect(shouldCloseClipEditorOnLaneSwitch(null, 'tb-303-1')).toBe(false);
  });
});

// ── The inspector's side ───────────────────────────────────────────────────

function mountDom(): void {
  document.body.innerHTML = `
    <div id="session-view-root">
      <div class="page" data-page="303" hidden></div>
      <div class="page" data-page="drums" hidden></div>
      <div class="page" data-page="poly" hidden></div>
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

const DRUMS: SessionLane = {
  id: 'drums-1', engineId: 'drums-machine', name: 'Drums 1',
  clips: [{ id: 'c-drums', name: 'Beat', lengthBars: 2, notes: [] } as unknown as SessionClip],
} as unknown as SessionLane;

const BASS: SessionLane = {
  id: 'tb-303-1', engineId: 'tb303', name: 'Bass',
  clips: [{ id: 'c-bass', name: 'Acid', lengthBars: 2, notes: [] } as unknown as SessionClip],
} as unknown as SessionLane;

function makeState(): SessionState {
  return {
    lanes: [structuredClone(DRUMS), structuredClone(BASS)],
    scenes: [{ id: 's0', name: 'Drop', clipPerLane: {} }],
  } as unknown as SessionState;
}

/** A real inspector with the drums clip open. */
function openDrumsClip(state: SessionState, over: Partial<import('./session-inspector').InspectorDeps> = {}): SessionInspector {
  const insp = new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: () => {},
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
    ...over,
  });
  insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
  insp.openInspector();
  return insp;
}

const panel = () => document.getElementById('session-inspector') as HTMLElement;

describe('SessionInspector.closeIfOtherLane', () => {
  beforeEach(() => mountDom());

  it('closes the editor when the newly-selected lane is not the open clip\'s', () => {
    const insp = openDrumsClip(makeState());
    expect(panel().hidden, 'precondition: the drums clip is open').toBe(false);

    insp.closeIfOtherLane('tb-303-1');

    expect(panel().hidden, 'the panel is hidden').toBe(true);
    expect(insp.getSelectedClip(), 'the selection is dropped').toBeNull();
  });

  it('leaves the editor open when the selected lane owns the open clip', () => {
    const insp = openDrumsClip(makeState());

    insp.closeIfOtherLane('drums-1');

    expect(panel().hidden).toBe(false);
    expect(insp.getSelectedClip()).toEqual({ laneId: 'drums-1', clipIdx: 0 });
  });

  it('commits an in-flight breadcrumb rename instead of dropping it', () => {
    const state = makeState();
    const insp = openDrumsClip(state);
    // The user is mid-rename on the track name when they click another lane.
    document.getElementById('insp-context-track')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.inline-rename-input') as HTMLInputElement;
    input.value = 'Beats';

    insp.closeIfOtherLane('tb-303-1');

    expect(state.lanes[0].name, 'the typed name survives the close').toBe('Beats');
    expect(document.querySelector('.inline-rename-input'), 'the rename input is gone').toBeNull();
    expect(panel().hidden).toBe(true);
  });

  it('leaves the play button inert (not stale) once nothing is open', () => {
    const onPlayClip = vi.fn();
    const insp = openDrumsClip(makeState(), { onPlayClip, isLanePlaying: () => false });

    insp.closeIfOtherLane('tb-303-1');

    const play = document.getElementById('insp-play') as HTMLButtonElement;
    expect(play.disabled, 'a closed editor has nothing to play').toBe(true);
    play.click();
    expect(onPlayClip, 'the stale selection cannot be launched').not.toHaveBeenCalled();
  });

  it('opening a clip never closes the editor it just opened', () => {
    // The trap: openInspector() announces the clip's lane via onClipFocused. If
    // that announcement closed "another lane's" editor, clicking a cell in lane B
    // would open and immediately close it.
    const state = makeState();
    const insp = openDrumsClip(state);
    insp.closeIfOtherLane('drums-1');   // what onClipFocused('drums-1') amounts to

    insp.setSelectedClip({ laneId: 'tb-303-1', clipIdx: 0 });
    insp.openInspector();

    expect(panel().hidden, 'the bass clip stays open').toBe(false);
    expect(insp.getSelectedClip()).toEqual({ laneId: 'tb-303-1', clipIdx: 0 });
  });
});

// ── The lane-header click path (onEditLane → showLaneEditor) ───────────────

function makeSelf(state: SessionState, insp: SessionInspector): SessionHost {
  return {
    state,
    inspector: insp,
    activeEditLane: 'drums-1',
    synthCollapsed: false,
    renderWithMixer: () => {},
    deps: { onActiveLaneChanged: vi.fn(), showPolyEditor: vi.fn(), setActiveEngineLane: vi.fn() },
  } as unknown as SessionHost;
}

describe('showLaneEditor — the lane the user clicked owns the editor', () => {
  beforeEach(() => mountDom());

  it('closes a clip editor left open on a different lane', () => {
    const state = makeState();
    const insp = openDrumsClip(state);
    expect(panel().hidden).toBe(false);

    showLaneEditor(makeSelf(state, insp), 'tb-303-1');

    expect(panel().hidden, 'the drums clip editor closed').toBe(true);
    expect(insp.getSelectedClip()).toBeNull();
  });

  it('keeps the editor open when the clicked lane is the open clip\'s own', () => {
    // Re-selecting the clip's own lane (header click, engine swap, undo repaint,
    // chevron collapse) must never take the editor away.
    const state = makeState();
    const insp = openDrumsClip(state);

    showLaneEditor(makeSelf(state, insp), 'drums-1');

    expect(panel().hidden).toBe(false);
    expect(insp.getSelectedClip()).toEqual({ laneId: 'drums-1', clipIdx: 0 });
  });
});
