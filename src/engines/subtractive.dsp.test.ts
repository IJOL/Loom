// src/engines/subtractive.dsp.test.ts
// Layer-3: real DSP tests for the Subtractive (poly) engine.

import { SubtractiveEngine } from './subtractive';
import { runStandardEngineBattery } from '../../test/dsp-battery';

runStandardEngineBattery({
  name: 'subtractive',
  createEngine: () => new SubtractiveEngine(),
  cutoffParamId: 'filter.cutoff',
  maxOutParams: {
    'filter.cutoff':    0.95,
    'filter.resonance': 0.9,
  },
  midi: 48,  // C3 — subtractive is a poly synth, mid register
});
