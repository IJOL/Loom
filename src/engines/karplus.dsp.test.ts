// src/engines/karplus.dsp.test.ts
// Layer-3: real DSP tests for the Karplus engine.
// Karplus-Strong has no traditional filter knob and no separate accent path
// (string excitation is fixed). We omit both from the battery.

import { KarplusEngine } from './karplus';
import { runStandardEngineBattery } from '../../test/dsp-battery';

runStandardEngineBattery({
  name: 'karplus',
  createEngine: () => new KarplusEngine(),
  midi: 48,
  hasAccent: false,
  maxOutParams: {
    // peakAmp = 1.4 * level * velMul; with velMul=1.0 (no accent in battery),
    // level=0.5 keeps the scheduled amp peak at 0.7, safely below 1.0 even
    // after string resonance contributes a few percent of headroom.
    'amp.level': 0.5,
  },
});
