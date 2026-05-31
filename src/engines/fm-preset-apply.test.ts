import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { FMEngine } from './fm';
import { __seedPresetCache, __resetPresetCache } from '../presets/preset-loader';
import type { EnginePreset } from './engine-types';

// Regression: changing an FM preset did nothing — applyPreset only restored
// modulators and dropped preset.params entirely, so neither the sound nor the
// knobs (getBaseValue → paramValues) reflected the preset.
//
// FM preset JSON keys ARE the engine's paramValues ids (op1.ratio, op3.level,
// algorithm, feedback…), so applying them through setBaseValue is correct.
//
// engine.presets reads getCachedPresets('fm'); seed + reset per test so this
// file is isolated from the rest of the suite.

const PRESET: EnginePreset = {
  name: 'TEST Bell',
  gm: [],
  params: {
    algorithm: 2, feedback: 0.42,
    'op1.ratio': 1, 'op1.level': 0.9,
    'op3.ratio': 4, 'op3.level': 0.25, 'op3.decay': 0.4,
    'amp.mix': 0.7,
  },
};

describe('FMEngine preset application (live-UI regression)', () => {
  beforeEach(() => { __resetPresetCache(); __seedPresetCache('fm', [PRESET]); });

  it('applyPreset writes params so getBaseValue (and the knobs) follow', () => {
    const engine = new FMEngine();

    expect(engine.getBaseValue('op3.ratio')).not.toBeCloseTo(4, 5);

    engine.applyPreset('TEST Bell');

    expect(engine.getBaseValue('algorithm')).toBe(2);
    expect(engine.getBaseValue('feedback')).toBeCloseTo(0.42, 5);
    expect(engine.getBaseValue('op1.ratio')).toBeCloseTo(1, 5);
    expect(engine.getBaseValue('op3.ratio')).toBeCloseTo(4, 5);
    expect(engine.getBaseValue('op3.level')).toBeCloseTo(0.25, 5);
    expect(engine.getBaseValue('amp.mix')).toBeCloseTo(0.7, 5);
  });
});
