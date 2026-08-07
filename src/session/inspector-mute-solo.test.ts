// @vitest-environment jsdom
//
// The clip header's M/S and the mixer column's M/S are two faces of one state.
// A second copy of the mute flags would drift the moment either side wrote it.

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
import type { SessionState, SessionClip, SessionLane } from './session';
import { fakeDestinations } from './fake-destinations';

function mountDom(): void {
  document.body.innerHTML = `
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
      <button id="insp-mute"></button>
      <button id="insp-solo"></button>
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

function makeState(): SessionState {
  return {
    lanes: [{
      id: 'tb-303-1', engineId: 'tb303', name: 'Bass',
      clips: [{ id: 'c0', name: 'Acid', lengthBars: 2, notes: [] } as unknown as SessionClip],
    }] as unknown as SessionLane[],
    scenes: [{ id: 's0', name: 'A', clipPerLane: {} }],
  } as unknown as SessionState;
}

const muteBtn = () => document.getElementById('insp-mute') as HTMLButtonElement;
const soloBtn = () => document.getElementById('insp-solo') as HTMLButtonElement;

function openBassClip(muteSolo: {
  muteState: Record<string, boolean>; soloState: Record<string, boolean>; apply: () => void;
}): SessionInspector {
  const state = makeState();
  const insp = new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: () => {},
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    destinations: fakeDestinations(),
    getAutoAbsSubIdx: () => 0,
    muteSolo,
  });
  insp.setSelectedClip({ laneId: 'tb-303-1', clipIdx: 0 });
  insp.openInspector();
  return insp;
}

describe('clip header mute/solo', () => {
  beforeEach(() => mountDom());

  it('mutes the open clip\'s lane in the shared state', () => {
    const apply = vi.fn();
    const muteState: Record<string, boolean> = {};
    openBassClip({ muteState, soloState: {}, apply });

    muteBtn().click();

    expect(muteState['tb-303-1'], 'the shared record is written').toBe(true);
    expect(apply, 'and the audio graph is told').toHaveBeenCalled();
  });

  it('shows a lane the mixer already muted as muted', () => {
    // The mixer wrote the flag before the clip was opened.
    openBassClip({ muteState: { 'tb-303-1': true }, soloState: {}, apply: () => {} });

    expect(muteBtn().classList.contains('active')).toBe(true);
  });

  it('solos through the same seam', () => {
    const apply = vi.fn();
    const soloState: Record<string, boolean> = {};
    openBassClip({ muteState: {}, soloState, apply });

    soloBtn().click();

    expect(soloState['tb-303-1']).toBe(true);
    expect(apply).toHaveBeenCalled();
  });

  it('disables both buttons when no clip is open', () => {
    const insp = openBassClip({ muteState: {}, soloState: {}, apply: () => {} });
    insp.closeInspector();

    expect(muteBtn().disabled).toBe(true);
    expect(soloBtn().disabled).toBe(true);
  });
});
