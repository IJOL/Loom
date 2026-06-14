// src/engines/westcoast.dsp.test.ts
// Layer-3: real DSP tests for the West Coast engine.
import { describe, it, expect } from 'vitest';
import { WestEngine } from './westcoast';
import { runStandardEngineBattery } from '../../test/dsp-battery';

runStandardEngineBattery({
  name: 'westcoast',
  createEngine: () => new WestEngine(),
  cutoffParamId: 'lpg.cutoff',
  maxOutParams: {
    'timbre.fold': 1.0,
    'lpg.cutoff': 0.95,
    'lpg.resonance': 0.9,
    'osc.fmIndex': 1.0,
  },
  midi: 48,
});
