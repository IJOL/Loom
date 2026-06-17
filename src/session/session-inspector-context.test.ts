// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { SessionInspector } from './session-inspector';
import type { SessionState, SessionClip, SessionLane } from './session';

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
      <select id="insp-quantize"><option value=""></option></select>
      <button id="insp-duplicate"></button><button id="insp-delete"></button>
      <button id="insp-copy"></button>
      <button id="insp-paste-replace" disabled></button>
      <button id="insp-paste-layer" disabled></button>
      <button id="insp-random-notes"></button><button id="insp-variate"></button>
      <button id="insp-invert-melodic"></button><button id="insp-retrograde"></button>
      <button id="insp-chords"></button>
      <select id="insp-examples-select"></select>
      <button id="insp-save-example"></button><button id="insp-export-example"></button>
      <button id="insp-toggle-editor"></button>
      <div id="insp-tonality"></div>
      <div id="insp-roll-host"></div>
    </div>`;
}

function makeInspector(over: { renderWithMixer?: () => void } = {}): { state: SessionState; lane: SessionLane } {
  const clip: SessionClip = { id: 'c0', name: 'Acid line', lengthBars: 2, notes: [] } as unknown as SessionClip;
  const lane: SessionLane = { id: 'bass', engineId: 'tb303', name: 'BASS', clips: [clip] } as unknown as SessionLane;
  const state = { lanes: [lane], scenes: [{ id: 's0', name: 'Drop', clipPerLane: {} }] } as unknown as SessionState;
  const insp = new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: over.renderWithMixer ?? (() => {}),
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
  });
  insp.setSelectedClip({ laneId: 'bass', clipIdx: 0 });
  insp.openInspector();
  return { state, lane };
}

describe('inspector context breadcrumb', () => {
  beforeEach(() => mountDom());

  it('shows the track, scene, row, and clip name', () => {
    makeInspector();
    expect(document.getElementById('insp-context-track')!.textContent).toBe('BASS');
    expect(document.getElementById('insp-context-scene')!.textContent).toBe('Drop');
    expect(document.getElementById('insp-context-row')!.textContent).toBe('(row 1)');
    expect((document.getElementById('insp-name') as HTMLInputElement).value).toBe('Acid line');
  });

  it('double-clicking the track name renames the lane', () => {
    const renderWithMixer = vi.fn();
    const { state } = makeInspector({ renderWithMixer });
    const trackEl = document.getElementById('insp-context-track')!;
    trackEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.inline-rename-input') as HTMLInputElement;
    input.value = 'Reese';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(state.lanes[0].name).toBe('Reese');
    expect(renderWithMixer).toHaveBeenCalled();
  });

  it('double-clicking the scene name renames the scene on the clip row', () => {
    const { state } = makeInspector();
    const sceneEl = document.getElementById('insp-context-scene')!;
    sceneEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.inline-rename-input') as HTMLInputElement;
    input.value = 'Verse';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(state.scenes[0].name).toBe('Verse');
  });
});
