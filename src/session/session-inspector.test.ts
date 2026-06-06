// @vitest-environment jsdom
// Task 3b (front E): Copy is honest — "Copy notes" lifts only `clip.notes`,
// never the whole clip, so a subsequent paste can't carry over name/sample/
// launchQuantize. This test drives the real #insp-copy handler through
// openInspector() and inspects the module-level clipboard.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// The embedded clip editor (canvas piano-roll) and automation lanes are
// irrelevant to the clipboard and unsafe under jsdom — stub renderClipEditor so
// openInspector()'s final renderEditor() call is a no-op. The pure helpers
// (classifyClip / isAudioClip / chooseClipEditor) stay real via importOriginal
// because openInspector() now calls classifyClip to gate the edit-row.
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: () => null,
}));
vi.mock('./clip-automation-lanes', () => ({
  renderClipAutomationLanes: () => {},
}));

import { SessionInspector, _getClipClipboardForTesting } from './session-inspector';
import type { SessionState, SessionClip, SessionLane } from './session';
import type { NoteEvent } from '../core/notes';

// Minimal inspector chrome that openInspector() reads/wires by id.
function mountInspectorDom(): void {
  document.body.innerHTML = `
    <div id="session-inspector" hidden>
      <input id="insp-name" type="text" />
      <input id="insp-length" type="number" />
      <select id="insp-quantize"><option value=""></option><option value="1/1">1 bar</option></select>
      <button id="insp-duplicate"></button>
      <button id="insp-delete"></button>
      <button id="insp-copy"></button>
      <button id="insp-paste-replace" disabled></button>
      <button id="insp-paste-layer" disabled></button>
      <button id="insp-toggle-editor"></button>
      <button id="insp-random-notes"></button>
      <div id="insp-roll-host"></div>
    </div>`;
}

const NOTES: NoteEvent[] = [
  { start: 0, duration: 24, midi: 60, velocity: 90 },
  { start: 48, duration: 24, midi: 64, velocity: 110 },
];

function makeClip(): SessionClip {
  return {
    id: 'clip-1',
    name: 'My Clip',
    lengthBars: 2,
    launchQuantize: '1/1',
    notes: JSON.parse(JSON.stringify(NOTES)),
    sample: { sampleId: 'snd', mode: 'loop', trimStart: 0, trimEnd: 1 },
  } as unknown as SessionClip;
}

function makeInspector(clip: SessionClip): SessionInspector {
  const lane: SessionLane = { id: 'lane-1', engineId: 'subtractive', clips: [clip] } as unknown as SessionLane;
  const state = { lanes: [lane] } as unknown as SessionState;
  const insp = new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: () => {},
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
  });
  insp.setSelectedClip({ laneId: 'lane-1', clipIdx: 0 });
  insp.openInspector();
  return insp;
}

describe('Copy notes (front E · Task 3b)', () => {
  beforeEach(() => {
    mountInspectorDom();
  });

  it('Copy lifts only the notes, not name/sample/launchQuantize', () => {
    const clip = makeClip();
    makeInspector(clip);

    (document.getElementById('insp-copy') as HTMLButtonElement).click();

    const cb = _getClipClipboardForTesting();
    expect(cb).not.toBeNull();
    expect(cb!.notes).toEqual(NOTES);
    // The clipboard is notes-only: no whole-clip metadata leaks in.
    expect(cb).not.toHaveProperty('name');
    expect(cb).not.toHaveProperty('sample');
    expect(cb).not.toHaveProperty('launchQuantize');
    expect(cb).not.toHaveProperty('id');
    expect(Object.keys(cb!)).toEqual(['notes']);
  });

  it('Copy deep-clones the notes (later clip mutation does not bleed into the clipboard)', () => {
    const clip = makeClip();
    makeInspector(clip);

    (document.getElementById('insp-copy') as HTMLButtonElement).click();
    // Mutate the live clip after copying.
    clip.notes[0].midi = 7;
    clip.notes.push({ start: 96, duration: 24, midi: 72, velocity: 90 });

    const cb = _getClipClipboardForTesting();
    expect(cb!.notes).toEqual(NOTES); // unchanged snapshot
  });

  it('Copy on a clip with no notes yields an empty notes array (never undefined)', () => {
    const clip = makeClip();
    (clip as unknown as { notes?: NoteEvent[] }).notes = undefined;
    makeInspector(clip);

    (document.getElementById('insp-copy') as HTMLButtonElement).click();

    const cb = _getClipClipboardForTesting();
    expect(cb).not.toBeNull();
    expect(cb!.notes).toEqual([]);
  });

  it('Copy enables the paste buttons', () => {
    const clip = makeClip();
    makeInspector(clip);

    const pasteR = document.getElementById('insp-paste-replace') as HTMLButtonElement;
    const pasteL = document.getElementById('insp-paste-layer') as HTMLButtonElement;

    (document.getElementById('insp-copy') as HTMLButtonElement).click();

    expect(pasteR.disabled).toBe(false);
    expect(pasteL.disabled).toBe(false);
  });
});
