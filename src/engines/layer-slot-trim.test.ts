// What scales ONE rack slot before its own fader, and why all of it rides
// `trim` rather than arriving as params.
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {}, registerModulatorKernel: () => {},
  };
});
import { slotTrim, rackNormalises } from './layers-engine';
import { seedEnginePresets, __resetPresetCache } from '../presets/preset-loader';
import { _resetPresetEnergy } from '../presets/preset-energy-loader';
import { registerEngineCapabilities } from '../plugins/capabilities';
import type { LayerSpec } from '../audio-dsp/layers/layer-spec';
import type { SessionLane } from '../session/session';

const ENGINE = 'trim-probe';
const TARGET = 0.5;
/** outputTrim 0.25 x CATEGORY_GAIN.synth 1.2. */
const ENGINE_FACTOR = 0.3;

const slot = (presetName?: string): LayerSpec =>
  ({ engineId: ENGINE, lo: 0, hi: 127, gain: 1, presetName });

beforeEach(() => {
  __resetPresetCache();
  // The engine asks for a quarter, exactly as subtractive does.
  // The third argument matters: pluginSynthTrim only answers for a PLUGIN id,
  // and it folds in CATEGORY_GAIN.synth (1.2), so the engine factor is 0.3.
  registerEngineCapabilities(ENGINE, { outputTrim: 0.25 } as never, true);
  seedEnginePresets(ENGINE, [
    { name: 'Trimmed', params: { 'output.trim': 0.5 } },
    { name: 'Plain', params: {} },
    { name: 'Quiet', params: {} },
  ] as never);
  _resetPresetEnergy({ target: TARGET, levels: {
    [`${ENGINE}::Trimmed`]: TARGET,          // already at the centre
    [`${ENGINE}::Plain`]: TARGET / 2,        // wants +6 dB
    [`${ENGINE}::Quiet`]: TARGET / 1000,     // wants far more than it may have
  } });
});

describe('a slot’s trim', () => {
  it('carries the ENGINE balance, as it always did', () => {
    expect(slotTrim(slot('Plain'), false)).toBeCloseTo(ENGINE_FACTOR, 6);
  });

  it('carries the PRESET’s own output.trim — which used to be dropped', () => {
    // The measured defect: `output.trim` is not a declared param, so a slot's
    // params (which come from the engine's spec) had nowhere to put it and it
    // vanished. On a lane the host seeds it by hand for that same reason.
    expect(slotTrim(slot('Trimmed'), false)).toBeCloseTo(ENGINE_FACTOR * 0.5, 6);
  });

  it('levels a quiet preset towards the target when asked', () => {
    // Plain measured half the target, so it is lifted by two.
    expect(slotTrim(slot('Plain'), true)).toBeCloseTo(ENGINE_FACTOR * 2, 6);
  });

  it('will not lift one further than the limit, however quiet', () => {
    // 1000x under would ask for +60 dB. It gets twelve.
    expect(slotTrim(slot('Quiet'), true)).toBeCloseTo(ENGINE_FACTOR * 4, 6);
  });

  it('leaves a hand-turned slot alone — no preset name, nothing measured', () => {
    expect(slotTrim(slot(undefined), true)).toBeCloseTo(ENGINE_FACTOR, 6);
  });

  it('does nothing at all with no table loaded', () => {
    _resetPresetEnergy(null);
    expect(slotTrim(slot('Plain'), true)).toBeCloseTo(ENGINE_FACTOR, 6);
  });
});

describe('the rack’s switch', () => {
  const lane = (v?: boolean): SessionLane =>
    ({ engineState: v === undefined ? {} : { layerNormalise: v } } as unknown as SessionLane);

  it('levels by default, because that is the reported problem', () => {
    expect(rackNormalises(lane())).toBe(true);
    expect(rackNormalises(undefined)).toBe(true);
  });

  it('stops when the rack says so — the difference IS the arrangement', () => {
    expect(rackNormalises(lane(false))).toBe(false);
  });

  it('only `false` turns it off, so a stray field cannot silently disable it', () => {
    expect(rackNormalises({ engineState: { layerNormalise: 0 } } as unknown as SessionLane)).toBe(true);
  });
});
