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
});
