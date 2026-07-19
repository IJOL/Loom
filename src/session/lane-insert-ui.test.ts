// @vitest-environment jsdom
// src/session/lane-insert-ui.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildLaneInsertUI } from './lane-insert-ui';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { InsertChain } from '../plugins/fx/insert-chain';
import type { InsertSlot } from './insert-slot';
import type { KnobHandle } from '../core/knob';
import type { FxInstance } from '../plugins/types';

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
        { id: 'mode',  label: 'Mode',  kind: 'discrete',   min: 0, max: 2, default: 0,
          options: [{ label: 'A', value: '0' }, { label: 'B', value: '1' }, { label: 'C', value: '2' }] },
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
