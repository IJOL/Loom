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
  /** Key into the engine's own declared `groups` table (EngineParamGroup[]).
   *  Title, row-packing and knob-ring colour all come from that table entry,
   *  not from this field — `group` only points at it. Absent ⇒ the param
   *  renders in the leading ungrouped row. Consumed by
   *  engine-param-grid.buildEngineParamGrid / resolveParamRows. */
  group?: string;
  /** This param is declared for automation / modulation / presets / saves, but
   *  the editor grid does not draw it — the named surface does. It NEVER means
   *  "drawn nowhere": a sound param with no control at all is a bug, not a
   *  feature. 'modulators' = the ADSR/LFO panel owns it (the subtractive amp and
   *  filter envelope leaves); 'mixer' is RESERVED and not yet set by any spec —
   *  strip params are still filtered by `isStripParamId` inside the grid, not
   *  by this tag. */
  drawnBy?: 'mixer' | 'modulators';
  options?: Array<{ value: string; label: string }>;   // only when kind === 'discrete'
  /** Discrete only. THE rule, for every discrete param on every surface that
   *  draws one — the grouped grid, the flat layout, the FX insert rack (see
   *  engine-param-grid.ts's header), and a modulator's own config card too:
   *  it renders through createSelectControl, NEVER a knob. ≤4 options draw a
   *  radio strip; more than that draw a native <select>. The strip stacks
   *  VERTICALLY only on the engine grid and the FX insert rack — those two
   *  pass `compact: true`; every other surface leaves it unset and stays
   *  HORIZONTAL (see select-control.ts's header for that boundary — it is
   *  NOT the same rule as select-vs-knob above, which holds everywhere).
   *  'dropdown' forces the native <select> at ANY option count — for many or
   *  long-labelled options (e.g. the FM algorithm) so the control stays
   *  narrow. There used to be a 'radio' value that opted a param INTO this
   *  same behaviour when the default was still a knob; now that
   *  select-control is the only path, opting in is meaningless and the
   *  value was removed from this type (Task 8b). */
  selectStyle?: 'dropdown';
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
