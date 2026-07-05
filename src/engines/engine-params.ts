// src/engines/engine-params.ts
// Canonical per-engine param schema. Drives knob construction, automation
// registry ids, modulator destination ids, and voice AudioParam lookup.
// One id per param, used in every layer.

export interface EngineParamSpec {
  id: string;              // dot-namespaced within engine: 'filter.cutoff', 'amp.attack', 'osc1.level'
  label: string;           // user-facing
  kind: 'continuous' | 'discrete';
  min: number;             // continuous: param range; discrete: 0
  max: number;             // continuous: param range; discrete: options.length - 1
  default: number;         // continuous: initial value; discrete: index of default option
  curve?: 'linear' | 'exponential' | 'log';
  unit?: string;
  /** Optional knob ring colour (CSS colour). Used to carry the Send A/B colour
   *  code (A=delay blue, B=reverb purple) onto the per-voice drum mixer knobs so
   *  the bare 'A'/'B' labels stay distinguishable, matching the master strip +
   *  mixer. Continuous params only; falls back to createKnob's default amber. */
  color?: string;
  /** Optional layout group. Params sharing a group id render together in one
   *  labelled row (label = the group string); ungrouped params render in the
   *  leading row. Consumed by engine-param-grid.buildEngineParamGrid. */
  group?: string;
  options?: Array<{ value: string; label: string }>;   // only when kind === 'discrete'
  /** Discrete only: 'dropdown' forces a native <select> instead of the default
   *  radio-button strip — for many or long-labelled options (e.g. the FM
   *  algorithm) so the control stays compact. Default: radio strip when ≤4. */
  selectStyle?: 'radio' | 'dropdown';
  /** Discrete only: show the param label above the control (default off). For
   *  controls whose option text isn't self-describing, e.g. CHOKE (—/1/2/3/4). */
  showLabel?: boolean;
}

export function isContinuous(s: EngineParamSpec): boolean {
  return s.kind === 'continuous';
}

export function isDiscrete(s: EngineParamSpec): boolean {
  return s.kind === 'discrete';
}

export function validateSpec(s: EngineParamSpec): void {
  if (!s.id || !s.id.length) throw new Error(`spec.id required`);
  if (!s.label) throw new Error(`spec.label required: ${s.id}`);
  if (s.kind === 'continuous') {
    if (!(s.max > s.min)) throw new Error(`spec ${s.id} must satisfy max > min`);
  } else {
    if (!s.options || s.options.length < 2) throw new Error(`spec ${s.id} (discrete) needs at least 2 options`);
  }
}
