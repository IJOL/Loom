// src/audio-dsp/filter-kinds.ts
// The filter list, as data. ONE table, read by the dropdown and by the DSP that
// builds the filter — so the label and the circuit cannot drift apart.
//
// It replaces a 3x4 grid of Model x Type, two of whose twelve points were lies:
// a ladder has no honest notch (its resonance feedback fills the null, and on
// the diode model at res 0.7 the null inverts into a BUMP), so choosing NOTCH on
// MOG or 303 quietly handed back the LOWPASS. A list cannot express that: an
// entry either works or it is not in it.
//
// Duplicates ARE the point. Three lowpasses and three highpasses is not
// redundancy — 12 dB/oct state-variable, 24 dB/oct Moog ladder and 24 dB/oct
// diode ladder are three different sounds, and the label says which is which.
//
// Data only, no classes: the main-thread param spec imports this for the
// dropdown, and pulling the ladder DSP into that bundle would be a waste.

export interface FilterKind {
  /** Stable id, written into presets and saves. Never renumber; append. */
  value: string;
  /** What the dropdown shows: response, then slope, then circuit — what it does
   *  first, what it costs second, what it is made of last. */
  label: string;
  /** Which circuit: the state-variable filter, or one of the two ladders. */
  model: 'dig' | 'moog' | 'diode';
  /** Which response is taken out of it. */
  tap: 'lp' | 'hp' | 'bp' | 'notch';
}

/** Index = the `filter.kind` / `filter2.kind` param value. Index 0 is the
 *  pre-list default (DIG + LP), so a patch that never mentions the filter keeps
 *  the sound it was voiced with. */
export const FILTER_KINDS: readonly FilterKind[] = [
  { value: 'lp12dig',  label: 'LP 12 DIG',  model: 'dig',   tap: 'lp' },
  { value: 'lp24mog',  label: 'LP 24 MOG',  model: 'moog',  tap: 'lp' },
  { value: 'lp24acid', label: 'LP 24 303',  model: 'diode', tap: 'lp' },
  { value: 'hp12dig',  label: 'HP 12 DIG',  model: 'dig',   tap: 'hp' },
  { value: 'hp24mog',  label: 'HP 24 MOG',  model: 'moog',  tap: 'hp' },
  { value: 'hp24acid', label: 'HP 24 303',  model: 'diode', tap: 'hp' },
  { value: 'bp12dig',  label: 'BP 12 DIG',  model: 'dig',   tap: 'bp' },
  { value: 'bp12mog',  label: 'BP 12 MOG',  model: 'moog',  tap: 'bp' },
  { value: 'bp12acid', label: 'BP 12 303',  model: 'diode', tap: 'bp' },
  // The notch is DIG only, and deliberately last: it is the one response the
  // ladders cannot do honestly, so it has no MOG/303 siblings to sit next to.
  { value: 'notchdig', label: 'NOTCH DIG',  model: 'dig',   tap: 'notch' },
];

/** The dropdown, straight off the table. */
export const FILTER_KIND_OPTIONS = FILTER_KINDS.map((k) => ({ value: k.value, label: k.label }));

/** How filter B is wired to filter A. Index = the `filter.routing` param value.
 *  OFF is index 0 and the default: filter B is never built and never runs. */
export const FILTER_ROUTING_OPTIONS = [
  { value: 'off',  label: 'Off' },
  { value: 'ser',  label: 'Series' },
  { value: 'par',  label: 'Parallel' },
  { value: 'diff', label: 'Difference' },
];

export const ROUTING_OFF = 0;
export const ROUTING_SER = 1;
export const ROUTING_PAR = 2;
export const ROUTING_DIFF = 3;
