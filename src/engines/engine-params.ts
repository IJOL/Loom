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
  options?: Array<{ value: string; label: string }>;   // only when kind === 'discrete'
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
