// @vitest-environment jsdom
//
// Task 9 (beyond the literal brief): before this task, mountLaneInserts'
// onChange called this.refreshClipAutomation() DIRECTLY — a mutation site
// reaching out and refreshing one specific panel it happened to know about.
// That direct call is now gone (see session-inspector.ts's mountLaneInserts).
// This test proves the open clip's automation picker still refreshes when an
// insert is added — but ONLY through the DestinationRegistry subscription set
// up in renderEditor(). If that subscription is removed (or never wired), this
// test goes red: unlike modulation-ui-dest-refresh.test.ts's subject, nothing
// else in this path re-renders the picker.
//
// renderClipAutomationLanes and buildLaneInsertUI run for REAL here (not
// mocked) — the whole point is to observe the picker's actual <select>
// options change through the real registry, mirroring
// modulation-ui-dest-refresh.test.ts's "REAL registered fx plugin, not a bare
// pluginId string" discipline (listAutomationTargets silently returns [] for
// an unregistered plugin id).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const rollMock = vi.hoisted(() => ({ redraw: () => {}, getOctaveBase: () => 60, setOctaveBase: vi.fn() }));
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: () => rollMock,
}));
vi.mock('./example-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./example-loader')>()),
  loadAllExamples: async () => [],
}));

import { SessionInspector } from './session-inspector';
import { createDestinationRegistry } from '../automation/destination-registry';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { InsertChain } from '../plugins/fx/insert-chain';
import type { LaneResourceMap } from '../core/lane-resources';
import type { SessionState, SessionClip, SessionLane } from './session';
import type { FxInstance } from '../plugins/types';
// Side-effect import: registers the 'subtractive' engine descriptor so
// listAutomationTargets() can find its continuous engine params (same trap
// noted in modulation-ui-dest-refresh.test.ts).
import '../engines/subtractive';

// ── Minimal fake AudioContext / fx plugin (mirrors lane-insert-ui.test.ts) ──

class FakeAudioNode {
  connections: FakeAudioNode[] = [];
  connect(n: FakeAudioNode) { this.connections.push(n); return n; }
  disconnect() { this.connections = []; }
}
class FakeAudioContext { createGain() { return new FakeAudioNode(); } }

function makeFakeFx(): FxInstance {
  const input = new FakeAudioNode() as unknown as AudioNode;
  const output = new FakeAudioNode() as unknown as AudioNode;
  const vals: Record<string, number> = { drive: 0.5 };
  return {
    input, output,
    getAudioParams: () => new Map(),
    getBaseValue: (id) => vals[id] ?? 0,
    setBaseValue: (id, v) => { vals[id] = v; },
    applyPreset: () => {},
    dispose: () => {},
  };
}

const TEST_PLUGIN_ID = 'test-fx-for-clip-auto-refresh';

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
      <div id="insp-inserts-host"></div>
    </div>`;
}

function autoSelectValues(): string[] {
  const sel = document.querySelector<HTMLSelectElement>('.clip-auto-param-select')!;
  return [...sel.options].map((o) => o.value);
}

beforeEach(() => {
  mountDom();
  _resetRegistry();
  registerPlugin({
    kind: 'fx',
    manifest: {
      id: TEST_PLUGIN_ID, name: 'Test FX', kind: 'fx', version: '1.0.0',
      params: [{ id: 'drive', label: 'Drive', kind: 'continuous', min: 0, max: 1, default: 0.5 }],
      presets: [],
    },
    create: () => makeFakeFx(),
  });
});

afterEach(() => { _resetRegistry(); });

describe('the open clip\'s automation picker refreshes through the destination registry', () => {
  it('offers a param from an insert added AFTER the picker rendered — via destinations.invalidate(), not a direct refresh call', () => {
    const clip: SessionClip = { id: 'c0', name: 'Line', lengthBars: 1, notes: [] } as unknown as SessionClip;
    const lane: SessionLane = {
      id: 'poly1', engineId: 'subtractive', name: 'Sub 1', clips: [clip], inserts: [],
    } as unknown as SessionLane;
    const state = {
      lanes: [lane], scenes: [{ id: 's0', name: 'Drop', clipPerLane: {} }],
    } as unknown as SessionState;

    const destinations = createDestinationRegistry({
      getState: () => state, getKnobRegistry: () => new Map(),
    });

    const ctx = new FakeAudioContext() as unknown as AudioContext;
    const chain = new InsertChain(
      new FakeAudioNode() as unknown as AudioNode,
      new FakeAudioNode() as unknown as AudioNode,
    );
    const laneResources = {
      get: (id: string) => (id === 'poly1' ? { inserts: chain } : undefined),
    } as unknown as LaneResourceMap;

    const insp = new SessionInspector({
      ctx,
      seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
      state,
      laneStates: new Map(),
      renderWithMixer: () => {},
      midiLabel: (m: number) => String(m),
      automationRegistry: new Map(),
      getAutoAbsSubIdx: () => 0,
      destinations,
      laneResources,
      // Mirrors main.ts's real wiring: an insert add/remove announces itself
      // to the ONE registry, which is what the picker subscribes to.
      onDestinationsChanged: () => destinations.invalidate(),
    });

    insp.setSelectedClip({ laneId: 'poly1', clipIdx: 0 });
    insp.openInspector();

    const insertsHost = document.getElementById('insp-inserts-host')!;
    insp.mountLaneInserts('poly1', insertsHost);

    expect(autoSelectValues().some((v) => v.startsWith('poly1.fx:'))).toBe(false);

    // Add an insert through the REAL UI path — the same click a user makes.
    insertsHost.querySelector<HTMLButtonElement>('.insert-add')!.click();
    const picker = insertsHost.querySelector<HTMLSelectElement>('.insert-add-picker')!;
    picker.value = TEST_PLUGIN_ID;
    picker.dispatchEvent(new Event('change'));

    expect(autoSelectValues().some((v) => v.startsWith('poly1.fx:'))).toBe(true);
  });
});
