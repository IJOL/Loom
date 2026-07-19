// @vitest-environment jsdom
// src/core/fx-ui.test.ts
//
// Covers review Finding 1: the master insert rack and the two send-bus insert
// racks are built by buildLaneInsertUI (same as a lane's own rack) but wireFxUI
// never passed onDestinationsChanged through, so adding/removing a master or
// send insert never invalidated the automation destination registry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../test/setup';
import { wireFxUI, type FxUIDeps } from './fx-ui';
import { FxBus, MasterCompressor } from './fx';
import { InsertChain } from '../plugins/fx/insert-chain';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import type { FxInstance } from '../plugins/types';

const TEST_PLUGIN_ID = 'test-fx-for-fx-ui';

function makeFakeFx(ctx: AudioContext): FxInstance {
  return {
    input: ctx.createGain(),
    output: ctx.createGain(),
    getAudioParams: () => new Map(),
    getBaseValue: () => 0,
    setBaseValue: () => {},
    applyPreset: () => {},
    dispose: () => {},
  };
}

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
      ],
      presets: [],
    },
    create: (ctx: AudioContext) => makeFakeFx(ctx),
  });
  document.body.innerHTML = `
    <div id="fx-master-comp-knobs"></div>
    <div id="fx-filters"></div>
    <div id="fx-send-a"></div>
    <div id="fx-send-b"></div>
  `;
});

afterEach(() => {
  _resetRegistry();
});

function makeDeps(ctx: AudioContext, onDestinationsChanged?: () => void): FxUIDeps {
  const fx = new FxBus(ctx, ctx.destination);
  const masterInsertChain = new InsertChain(ctx.createGain(), ctx.destination);
  const masterComp = new MasterCompressor(ctx);
  return {
    ctx, fx, masterInsertChain, masterComp,
    getBpm: () => 120,
    registerKnob: () => {},
    onDestinationsChanged,
  };
}

describe('wireFxUI — master insert rack announces destination-set changes', () => {
  it('announces when an insert is added to the master rack', () => {
    const ctx = new AudioContext();
    const spy = vi.fn();
    wireFxUI(makeDeps(ctx, spy));

    const container = document.getElementById('fx-filters')!;
    container.querySelector<HTMLButtonElement>('.insert-add')!.click();
    const picker = container.querySelector<HTMLSelectElement>('.insert-add-picker')!;
    picker.value = TEST_PLUGIN_ID;
    picker.dispatchEvent(new Event('change'));

    expect(spy).toHaveBeenCalled();
  });

  it('announces when an insert is removed from the master rack', () => {
    const ctx = new AudioContext();
    const spy = vi.fn();
    wireFxUI(makeDeps(ctx, spy));

    const container = document.getElementById('fx-filters')!;
    container.querySelector<HTMLButtonElement>('.insert-add')!.click();
    const picker = container.querySelector<HTMLSelectElement>('.insert-add-picker')!;
    picker.value = TEST_PLUGIN_ID;
    picker.dispatchEvent(new Event('change'));
    spy.mockClear(); // isolate the remove from the add above

    container.querySelector<HTMLButtonElement>('.insert-rm')!.click();
    expect(spy).toHaveBeenCalled();
  });
});

describe('wireFxUI — send-bus insert racks announce destination-set changes', () => {
  it('announces when an insert is added to Send A', () => {
    const ctx = new AudioContext();
    const spy = vi.fn();
    wireFxUI(makeDeps(ctx, spy));

    const container = document.getElementById('fx-send-a')!;
    container.querySelector<HTMLButtonElement>('.insert-add')!.click();
    const picker = container.querySelector<HTMLSelectElement>('.insert-add-picker')!;
    picker.value = TEST_PLUGIN_ID;
    picker.dispatchEvent(new Event('change'));

    expect(spy).toHaveBeenCalled();
  });

  it('announces when an insert is added to Send B', () => {
    const ctx = new AudioContext();
    const spy = vi.fn();
    wireFxUI(makeDeps(ctx, spy));

    const container = document.getElementById('fx-send-b')!;
    container.querySelector<HTMLButtonElement>('.insert-add')!.click();
    const picker = container.querySelector<HTMLSelectElement>('.insert-add-picker')!;
    picker.value = TEST_PLUGIN_ID;
    picker.dispatchEvent(new Event('change'));

    expect(spy).toHaveBeenCalled();
  });
});
