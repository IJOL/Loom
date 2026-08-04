// @vitest-environment jsdom
// src/session/lane-insert-ui.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildLaneInsertUI } from './lane-insert-ui';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { InsertChain } from '../plugins/fx/insert-chain';
import { buildEngineParamGrid } from '../engines/engine-param-grid';
import { rehydrateInsertChain, type InsertSlot } from './insert-slot';
import type { KnobHandle } from '../core/knob';
import type { FxInstance } from '../plugins/types';
import type { EngineParamSpec } from '../engines/engine-params';
import type { EngineUIContext } from '../engines/engine-types';

// ── Minimal fake AudioContext ───────────────────────────────────────────────

class FakeAudioNode {
  connections: FakeAudioNode[] = [];
  connect(n: FakeAudioNode) { this.connections.push(n); return n; }
  disconnect() { this.connections = []; }
}

class FakeAudioContext {
  createGain() { return new FakeAudioNode(); }
}

function makeCtx() { return new FakeAudioContext() as unknown as AudioContext; }

// ── Minimal FX plugin with two continuous params ────────────────────────────

function makeFakeFx(): FxInstance {
  const input  = new FakeAudioNode() as unknown as AudioNode;
  const output = new FakeAudioNode() as unknown as AudioNode;
  const vals: Record<string, number> = { drive: 0.5, mix: 1.0 };
  return {
    input, output,
    getAudioParams: () => new Map(),
    getBaseValue: (id) => vals[id] ?? 0,
    setBaseValue: (id, v) => { vals[id] = v; },
    applyPreset: () => {},
    dispose: () => {},
  };
}

const TEST_PLUGIN_ID = 'test-fx-for-insert-ui';

// 4 options — the boundary the one rule (Task 8b) draws a vertical strip at,
// used both in the fake plugin's manifest below and to build the SAME shape
// of discrete param through the engine grid, so the two render paths can be
// compared directly.
const MODE_OPTIONS = [
  { label: 'A', value: '0' }, { label: 'B', value: '1' },
  { label: 'C', value: '2' }, { label: 'D', value: '3' },
];

beforeEach(() => {
  _resetRegistry();
  registerPlugin({
    kind: 'fx',
    manifest: {
      id: TEST_PLUGIN_ID,
      name: 'Test FX',
      kind: 'fx',
      version: '1.0.0',
      params: [
        { id: 'drive', label: 'Drive', kind: 'continuous', min: 0, max: 1, default: 0.5 },
        { id: 'mix',   label: 'Mix',   kind: 'continuous', min: 0, max: 1, default: 1.0 },
        { id: 'mode',  label: 'Mode',  kind: 'discrete',   min: 0, max: 3, default: 0,
          options: MODE_OPTIONS },
      ],
      presets: [],
    },
    create: () => makeFakeFx(),
  });
  document.body.innerHTML = '';
});

afterEach(() => {
  _resetRegistry();
});

describe('buildLaneInsertUI — automation registration', () => {
  it('registers continuous param knobs with the prefixed id when automationScopeId is given', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);

    // Pre-populate the chain with our test plugin so buildLaneInsertUI renders it.
    chain.insert(makeFakeFx(), 'a');

    const slots: InsertSlot[] = [
      { id: 'a', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
    ];

    const registered: KnobHandle[] = [];
    const PREFIX = 'lane.test1';

    buildLaneInsertUI({
      ctx,
      container,
      chain,
      slots,
      onChange: () => {},
      registerKnob: (k) => registered.push(k),
      automationScopeId: PREFIX,
    });

    // Exactly 2 continuous params → 2 registered knobs (discrete 'mode' is skipped).
    expect(registered.length).toBeGreaterThan(0);

    // Every registered knob id must start with the prefix.
    for (const k of registered) {
      expect(k.meta.id).toBeTruthy();
      expect(k.meta.id!.startsWith(PREFIX + '.')).toBe(true);
    }

    // Check both param ids appear.
    const ids = registered.map((k) => k.meta.id!);
    expect(ids.some((id) => id.endsWith('.drive'))).toBe(true);
    expect(ids.some((id) => id.endsWith('.mix'))).toBe(true);

    // Discrete param 'mode' must NOT be registered.
    expect(ids.some((id) => id.endsWith('.mode'))).toBe(false);
  });

  it('does NOT call registerKnob when automationScopeId is absent (backward compat)', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);
    chain.insert(makeFakeFx(), 'a');

    const slots: InsertSlot[] = [
      { id: 'a', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
    ];

    const registered: KnobHandle[] = [];

    buildLaneInsertUI({
      ctx,
      container,
      chain,
      slots,
      onChange: () => {},
      // NOTE: no automationScopeId and no registerKnob
    });

    // Nothing registered — old behavior preserved.
    expect(registered.length).toBe(0);
  });

  it('knob id follows the pattern ${prefix}.fx:${slotId}.${paramId}', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);
    chain.insert(makeFakeFx(), 'a');

    const slots: InsertSlot[] = [
      { id: 'a', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
    ];

    const registered: KnobHandle[] = [];
    const PREFIX = 'lane.abc';

    buildLaneInsertUI({
      ctx,
      container,
      chain,
      slots,
      onChange: () => {},
      registerKnob: (k) => registered.push(k),
      automationScopeId: PREFIX,
    });

    const ids = registered.map((k) => k.meta.id!);
    expect(ids).toContain(`${PREFIX}.fx:a.drive`);
    expect(ids).toContain(`${PREFIX}.fx:a.mix`);
  });
});

describe('buildLaneInsertUI — announces destination-set changes', () => {
  // Uses the locally-registered TEST_PLUGIN_ID (not 'delay' — a plugin id that
  // isn't registered via registerPlugin in this suite's beforeEach makes
  // listPlugins()/createInstance() return nothing and the handler silently
  // no-ops, which would make an assertion pass for the wrong reason. Same
  // reasoning for using the FakeAudioContext/FakeAudioNode fixtures already
  // established in this file instead of a real `new AudioContext()`, which
  // jsdom does not implement.
  function setup() {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);
    return { ctx, container, chain };
  }

  it('announces a destination change when an insert is removed', () => {
    const { ctx, container, chain } = setup();
    chain.insert(makeFakeFx(), 'a');
    const slots: InsertSlot[] = [
      { id: 'a', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
    ];
    const onDestinationsChanged = vi.fn();

    buildLaneInsertUI({
      ctx, container, chain, slots,
      onChange: () => {},
      onDestinationsChanged,
    });

    container.querySelector<HTMLButtonElement>('.insert-rm')!.click();
    expect(onDestinationsChanged).toHaveBeenCalled();
  });

  it('announces a destination change when an insert is added', () => {
    const { ctx, container, chain } = setup();
    const slots: InsertSlot[] = [];
    const onDestinationsChanged = vi.fn();

    buildLaneInsertUI({
      ctx, container, chain, slots,
      onChange: () => {},
      onDestinationsChanged,
    });

    container.querySelector<HTMLButtonElement>('.insert-add')!.click();
    const picker = container.querySelector<HTMLSelectElement>('.insert-add-picker')!;
    picker.value = TEST_PLUGIN_ID;
    picker.dispatchEvent(new Event('change'));

    expect(onDestinationsChanged).toHaveBeenCalled();
  });

  it('does NOT announce a destination change on bypass — bypass keeps the param live, it does not add/remove it', () => {
    const { ctx, container, chain } = setup();
    chain.insert(makeFakeFx(), 'a');
    const slots: InsertSlot[] = [
      { id: 'a', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
    ];
    const onDestinationsChanged = vi.fn();

    buildLaneInsertUI({
      ctx, container, chain, slots,
      onChange: () => {},
      onDestinationsChanged,
    });

    const bypassBtn = container.querySelector<HTMLButtonElement>('.insert-unit-ctl .insert-btn:not(.insert-rm)')!;
    bypassBtn.click();
    expect(onDestinationsChanged).not.toHaveBeenCalled();
  });
});

describe('buildLaneInsertUI — compact unit layout (Option B)', () => {
  function setup(nInserts: number) {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);
    const slots: InsertSlot[] = [];
    for (let i = 0; i < nInserts; i++) {
      const id = `slot-${i}`;
      chain.insert(makeFakeFx(), id);
      slots.push({ id, pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false });
    }
    buildLaneInsertUI({ ctx, container, chain, slots, onChange: () => {} });
    return { container, slots };
  }

  it('renders each insert as a compact unit inside a horizontal insert-bar', () => {
    const { container } = setup(2);
    const bar = container.querySelector('.insert-bar');
    expect(bar).toBeTruthy();
    const units = bar!.querySelectorAll('.insert-unit');
    expect(units.length).toBe(2);
    for (const u of units) {
      // header (name) + a knob-row (compact, like the synth rows) + a control cluster
      expect(u.querySelector('.insert-unit-head')).toBeTruthy();
      expect(u.querySelector('.knob-row')).toBeTruthy();
      expect(u.querySelector('.insert-unit-ctl')).toBeTruthy();
      // the header shows the effect name
      expect(u.querySelector('.insert-unit-head')!.textContent).toContain('Test FX');
    }
    // the "+ Add insert" affordance is still present
    expect(container.querySelector('.insert-add')).toBeTruthy();
  });

  it('tints each unit with a per-effect colour (CSS var + dot)', () => {
    const { container } = setup(1);
    const unit = container.querySelector('.insert-unit') as HTMLElement;
    expect(unit).toBeTruthy();
    // a colour is assigned as a CSS custom property (real hue for known plugins,
    // fallback for others) and surfaced as a coloured dot in the header.
    expect(unit.style.getPropertyValue('--fx-color').trim()).not.toBe('');
    expect(unit.querySelector('.insert-unit-head .insert-dot')).toBeTruthy();
  });

  it('keeps the bypass + remove controls inside each unit', () => {
    const { container } = setup(1);
    const ctl = container.querySelector('.insert-unit .insert-unit-ctl') as HTMLElement;
    expect(ctl).toBeTruthy();
    const btns = ctl.querySelectorAll('button');
    // ON/BYP toggle + remove (×)
    expect(btns.length).toBeGreaterThanOrEqual(2);
    const texts = Array.from(btns).map((b) => b.textContent);
    expect(texts).toContain('×');
    expect(texts.some((t) => t === 'ON' || t === 'BYP')).toBe(true);
  });
});

// ── Task 8b: the third render path (this file used to hand-roll its own
// <select> here) must obey the SAME rule as the other two — the grouped and
// flat engine-param grids. This is the assertion that pins it: the identical
// shape of discrete param (4 options) must draw the identical control.
describe('buildLaneInsertUI — the FX rack obeys the one select-control rule', () => {
  function setup() {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);
    return { ctx, container, chain };
  }

  it('a 4-option FX insert param renders a .radio-strip, not a hand-rolled <select>', () => {
    const { ctx, container, chain } = setup();
    chain.insert(makeFakeFx(), 'a');
    const slots: InsertSlot[] = [
      { id: 'a', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
    ];
    buildLaneInsertUI({ ctx, container, chain, slots, onChange: () => {} });

    const strip = container.querySelector('.insert-unit-head .radio-strip');
    expect(strip).not.toBeNull();
    expect(container.querySelector('.insert-unit-head select')).toBeNull();
    expect(container.querySelector('.insert-unit-head .knob')).toBeNull();
    // Fix round 2: this is a param-editing surface, so it must opt into the
    // compact modifier itself — the base .radio-strip stays horizontal.
    expect(strip!.classList.contains('radio-strip--compact')).toBe(true);
  });

  it('renders the same control (.radio-strip) as an engine param of the identical 4-option shape', () => {
    const { ctx, container, chain } = setup();
    chain.insert(makeFakeFx(), 'a');
    const slots: InsertSlot[] = [
      { id: 'a', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
    ];
    buildLaneInsertUI({ ctx, container, chain, slots, onChange: () => {} });

    const modeSpec: EngineParamSpec = {
      id: 'mode', label: 'Mode', kind: 'discrete', min: 0, max: 3, default: 0, options: MODE_OPTIONS,
    };
    const stubEngine = {
      id: 'stub', params: [modeSpec],
      getBaseValue: () => 0, setBaseValue: () => {},
    };
    const stubCtx = { laneId: 'L', registerKnob: () => {}, registry: new Map() } as unknown as EngineUIContext;
    const grouped = document.createElement('div');
    const flat = document.createElement('div');
    buildEngineParamGrid(stubEngine, stubCtx, grouped);
    buildEngineParamGrid(stubEngine, stubCtx, flat, { layout: 'flat' });

    const insertControl = container.querySelector('.insert-unit-head .radio-strip');
    expect(insertControl).not.toBeNull();
    expect(grouped.querySelector('.radio-strip')).not.toBeNull();
    expect(flat.querySelector('.radio-strip')).not.toBeNull();
  });
});

describe('insert rack pairing — a unit takes its data from its own slot, not from the slot at its index', () => {
  // Two extra fx plugins, distinct from TEST_PLUGIN_ID and from each other, so
  // the rendered .insert-name for each chain entry is unambiguous evidence of
  // WHICH slot it was paired with.
  const SLOT_A_PLUGIN = 'pairing-test-a';
  const SLOT_C_PLUGIN = 'pairing-test-c';

  beforeEach(() => {
    registerPlugin({
      kind: 'fx',
      manifest: { id: SLOT_A_PLUGIN, name: 'Pairing A', kind: 'fx', version: '1.0.0', params: [], presets: [] },
      create: () => makeFakeFx(),
    });
    registerPlugin({
      kind: 'fx',
      manifest: { id: SLOT_C_PLUGIN, name: 'Pairing C', kind: 'fx', version: '1.0.0', params: [], presets: [] },
      create: () => makeFakeFx(),
    });
  });

  it('renders the chain\'s 2nd entry with its own slot, even though a missing-plugin slot sits between them in the persisted list', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);

    // Three slots persisted, but the MIDDLE one references a plugin id that is
    // never registered. The chain is built BY HAND here (not via
    // rehydrateInsertChain, which keeps a missing-plugin slot as a marked
    // placeholder rather than a gap) so only two entries reach the live chain —
    // exercising the general case where a gap exists for any reason. That gap
    // is what makes pairing by array index wrong: the chain's 2nd entry
    // (index 1) is really slot 'sC', not slot 'sB'.
    chain.insert(makeFakeFx(), 'sA');
    chain.insert(makeFakeFx(), 'sC');
    const slots: InsertSlot[] = [
      { id: 'sA', pluginId: SLOT_A_PLUGIN, params: {}, bypass: false },
      { id: 'sB', pluginId: 'ghost-fx',    params: {}, bypass: false }, // never reaches the chain
      { id: 'sC', pluginId: SLOT_C_PLUGIN, params: {}, bypass: false },
    ];

    buildLaneInsertUI({ ctx, container, chain, slots, onChange: () => {} });

    const units = container.querySelectorAll('.insert-unit');
    const names = Array.from(units).map((u) => u.querySelector('.insert-name')!.textContent);

    // Pairing by index would look up slots[1] for the chain's 2nd entry — the
    // ghost slot, whose plugin isn't registered, so that unit would render as
    // the missing-plugin placeholder (not 'Pairing C') and 'Pairing C' would
    // never appear; only 'Pairing A' would be there.
    expect(names).toContain('Pairing C');
    expect(units.length).toBe(2);
  });
});

describe('buildLaneInsertUI — a slot whose plugin is missing renders a marked unit', () => {
  it('shows the placeholder for its own slot; a neighbour with a resolvable plugin still shows its own name', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const inputNode  = new FakeAudioNode() as unknown as AudioNode;
    const outputNode = new FakeAudioNode() as unknown as AudioNode;
    const chain = new InsertChain(inputNode, outputNode);

    const slots: InsertSlot[] = [
      { id: 'sA', pluginId: TEST_PLUGIN_ID, params: { drive: 0.5, mix: 1.0, mode: 0 }, bypass: false },
      { id: 'sB', pluginId: 'ghost-fx', params: { x: 3 }, bypass: false },
    ];
    // rehydrateInsertChain is the REAL production path — the same call session
    // load, lane duplication and offline export all make to turn persisted slots
    // into a live chain, including the missing-plugin placeholder. Building the
    // chain this way (instead of hand-rolling it, like the pairing test above
    // does on purpose for a different reason) is what makes this test exercise
    // unitTemplate's `!factory` branch for real, not merely by construction.
    rehydrateInsertChain(ctx, chain, slots);

    buildLaneInsertUI({ ctx, container, chain, slots, onChange: () => {} });

    // Assert PRESENCE, never absence: an earlier round of this plan shipped an
    // acceptance check that certified something was missing and passed
    // identically for a broken plugin. The marked unit must actually be there.
    const missing = container.querySelector('.insert-unit-missing');
    expect(missing).not.toBeNull();
    expect(missing!.querySelector('.insert-name')!.textContent).toContain('⚠');
    expect(missing!.querySelector('.insert-name')!.textContent).toContain('ghost-fx');
    expect(missing!.getAttribute('title')).toContain('ghost-fx');
    expect(missing!.getAttribute('title')).toContain('This slot keeps its settings');

    // The other half of the contract the original bug broke: the neighbour
    // (a real, resolvable plugin) still renders its OWN name, unaffected by the
    // gap next to it.
    const units = container.querySelectorAll('.insert-unit');
    expect(units.length).toBe(2);
    const names = Array.from(units).map((u) => u.querySelector('.insert-name')!.textContent);
    expect(names.some((n) => n?.includes('Test FX'))).toBe(true);
  });
});
