import { describe, it, expect, afterEach } from 'vitest';
import '../../test/setup';
import { FMEngine } from './fm';
import { __seedPresetCache, __resetPresetCache } from '../presets/preset-loader';

// Regression: changing an FM preset did nothing — applyPreset only restored
// modulators and dropped preset.params entirely, so neither the sound nor the
// knobs (getBaseValue → paramValues) reflected the preset.
//
// FM preset JSON keys ARE the engine's paramValues ids (op1.ratio, op3.level,
// algorithm, feedback…), so applying them through setBaseValue is correct.

const PRESET = {
  name: 'TEST Bell',
  gm: [] as number[],
  params: {
    algorithm: 2, feedback: 0.42,
    'op1.ratio': 1, 'op1.level': 0.9,
    'op3.ratio': 4, 'op3.level': 0.25, 'op3.decay': 0.4,
    'amp.mix': 0.7,
  },
};

describe('FMEngine preset application (live-UI regression)', () => {
  afterEach(() => { __resetPresetCache(); });

  it('applyPreset writes params so getBaseValue (and the knobs) follow', () => {
    __seedPresetCache('fm', [PRESET]);
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
