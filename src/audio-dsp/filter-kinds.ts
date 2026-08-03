// src/audio-dsp/filter-kinds.ts
// The filter table, as data. ONE table, read by the Mode/Type controls and by
// the DSP that builds the filter — so the labels and the circuit cannot drift
// apart.
//
// Mode picks the circuit; Type picks the response taken out of it. Two of the
// twelve points of the old Model x Type grid were lies: a ladder has no honest
// notch (its resonance feedback fills the null, and on the diode model at res
// 0.7 the null inverts into a BUMP), so choosing NOTCH on MOG or 303 quietly
// handed back the LOWPASS. The fix is not a flat list of the ten that work —
// that grows multiplicatively with every circuit added, and degrades from two
// glanceable button strips into a dropdown the moment it passes four options
// (core/select-control.ts). Instead each mode DECLARES the taps it can
// honestly produce, and the Type control is built from THAT mode's list: pick
// MOG and the NOTCH button is not present, rather than present and lying.
//
// Data only, no classes: the main-thread param spec imports this for the
// Mode/Type controls, and pulling the ladder DSP into that bundle would be a
// waste.

export type FilterTap = 'lp' | 'hp' | 'bp' | 'notch' | 'comb+' | 'comb-' | 'combff';

export interface FilterMode {
  /** Stable id for presets and saves. */
  value: string;
  /** What the Mode control shows. Short: the Type control says the response. */
  label: string;
  /** The responses this circuit produces HONESTLY, in the order the Type
   *  control paints them. It is the option list, so a tap that is not here is
   *  not a button — which is the whole point. */
  taps: FilterTap[];
}

/** Index = the `filter.model` / `filter2.model` param value. 0..2 are DIG, MOG
 *  and 303 exactly as they have always been numbered, and each declares its taps
 *  in the order the old Type control used — so every preset value and every old
 *  save keeps the sound it stored. */
export const FILTER_MODES: readonly FilterMode[] = [
  { value: 'dig',  label: 'DIG',  taps: ['lp', 'hp', 'bp', 'notch'] },
  { value: 'mog',  label: 'MOG',  taps: ['lp', 'hp', 'bp'] },
  { value: 'acid', label: '303',  taps: ['lp', 'hp', 'bp'] },
  { value: 'comb', label: 'COMB', taps: ['comb+', 'comb-', 'combff'] },
];

const TAP_LABELS: Record<FilterTap, string> = {
  lp: 'LP', hp: 'HP', bp: 'BP', notch: 'NOTCH',
  'comb+': 'POS', 'comb-': 'NEG', combff: 'FF',
};

const clampIdx = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(v)));

/** The tap a (model, type) pair names. `type` indexes the MODE'S OWN taps and is
 *  clamped, so every pair — including one a hand-edited preset invented — names a
 *  response that mode really has. There is no invalid pair to resolve. */
export function tapFor(model: number, type: number): FilterTap {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps[clampIdx(type, m.taps.length)];
}

/** The Type control's options for a mode. The UI builds its buttons from this
 *  and nothing else. */
export function typeOptionsFor(model: number): Array<{ value: string; label: string }> {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps.map((t) => ({ value: t, label: TAP_LABELS[t] }));
}

/** The Type control's options for EVERY mode, keyed by the mode's index as a
 *  string. This is the form a manifest can carry — JSON has no numeric keys and
 *  no functions — and it is what `optionsFrom.table` reads. `typeOptionsFor`
 *  stays as the generator that builds it, and as the accessor the DSP uses. */
export const TYPE_OPTIONS_BY_MODE: Record<string, Array<{ value: string; label: string }>> =
  Object.fromEntries(FILTER_MODES.map((_m, i) => [String(i), typeOptionsFor(i)]));

export const FILTER_MODE_OPTIONS = FILTER_MODES.map((m) => ({ value: m.value, label: m.label }));

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
