// @loom/plugin-sdk — fx.ts — the shape a third-party insert compiles against.
// FxInstance used to live in src/plugins/types.ts; it moved here so there is
// exactly ONE declaration of it. src/plugins/types.ts now re-exports it.

export interface FxInstance {
  readonly input: AudioNode;
  readonly output: AudioNode;
  getAudioParams(): Map<string, AudioParam>;
  /** Native modulation range for a param (the binder uses max−min as the
   *  depth=1 peak gain). Omit → the binder falls back to 0..1. Frequency-type
   *  params should expose their modulation AudioParam as a .detune (cents) here
   *  via getAudioParams + return a cents span, so a bipolar LFO sweeps the
   *  filter exponentially instead of summing ±1 Hz (inaudible). */
  getAudioParamRange?(shortId: string): { min: number; max: number } | undefined;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  dispose(): void;
}

/** What an fx component declares beyond the common fields. */
export interface FxDeclaration {
  /** The unit's colour in the insert rack — the dot, the name and the box's
   *  --fx-color. Any CSS colour.
   *
   *  It is a THIRD place a colour can live, and that needs saying: a group
   *  declares the colour of an editor section, a param the ring of one knob.
   *  An insert has no sections — its unit is a single visual object — so its
   *  colour belongs to the component. Required, not optional: the six effects
   *  the old hand-written table covered looked deliberate and the other five
   *  looked deliberate too, and one of those was an oversight.
   */
  color: string;
}

/** The factory a plugin hands the host through Loom.registerFx. */
export type FxFactory = (ctx: AudioContext) => FxInstance;
