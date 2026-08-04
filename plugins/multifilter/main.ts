// plugins/multifilter/main.ts — one BiquadFilter with a switchable response.
// What it IS lives in plugin.json.
//
// The interesting part is what it hands the modulation binder. `freq` is
// exposed as the filter's `.detune` (cents, multiplicative) rather than its
// `.frequency` (Hz, additive), so a bipolar LFO sweeps the cutoff
// proportionally and audibly instead of summing ±1 Hz around it — inaudible on
// anything but the very lowest cutoffs. The knob and automation path still
// write `.frequency` directly; only modulation rides the detune.
import type { FxInstance } from '@loom/plugin-sdk';

/** Full-knob exponential sweep of the filter freq in cents (20 Hz..20 kHz =
 *  log2(1000) octaves). */
const FREQ_DETUNE_SPAN_CENTS = 1200 * Math.log2(20000 / 20);  // ≈ 11959 ¢

Loom.registerFx('multifilter', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const output = ctx.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = 1000;
  filter.Q.value = 1;
  input.connect(filter).connect(output);

  let typeIdx = 0;
  const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

  const params = new Map<string, AudioParam>([
    ['freq', filter.detune],
    ['q', filter.Q],
  ]);

  return {
    input, output,
    getAudioParams: () => params,
    getAudioParamRange: (id) => {
      if (id === 'freq') return { min: 0, max: FREQ_DETUNE_SPAN_CENTS };
      if (id === 'q')    return { min: 0, max: 24 };  // native Q span (knob 0.1..24)
      return undefined;
    },
    getBaseValue: (id) => {
      if (id === 'freq') return filter.frequency.value;
      if (id === 'q')    return filter.Q.value;
      if (id === 'type') return typeIdx;
      return 0;
    },
    setBaseValue: (id, v) => {
      if (id === 'freq') filter.frequency.value = v;
      if (id === 'q')    filter.Q.value = v;
      if (id === 'type') { typeIdx = v | 0; filter.type = types[typeIdx] ?? 'lowpass'; }
    },
    applyPreset: () => { /* no presets */ },
    dispose: () => { try { input.disconnect(); filter.disconnect(); output.disconnect(); } catch { /* ok */ } },
  };
});
