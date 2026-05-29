import {
  withCompDefaults,
  type CompState,
} from './comp-state';

// A reusable compressor block: input GainNode → DynamicsCompressorNode →
// makeup GainNode → output GainNode. When bypassed, input is rewired
// directly to output and the comp/makeup pair is disconnected.
//
// Both ChannelStrip (per-lane) and MasterCompressor (master bus) compose
// one of these. Construction does NOT touch any AudioParam after the
// initial assignment — subsequent setState() drives changes through
// setTargetAtTime so they're sample-accurate.

export class CompBlock {
  input: GainNode;
  output: GainNode;
  private comp: DynamicsCompressorNode;
  private makeup: GainNode;
  private state: CompState;

  constructor(private ctx: BaseAudioContext, initial: Partial<CompState> = {}) {
    this.state = withCompDefaults(initial);

    this.input  = ctx.createGain();
    this.comp   = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.output = ctx.createGain();

    this.comp.threshold.value = this.state.threshold;
    this.comp.ratio.value     = this.state.ratio;
    this.comp.attack.value    = this.state.attack;
    this.comp.release.value   = this.state.release;
    this.comp.knee.value      = this.state.knee;
    this.makeup.gain.value    = this.state.makeup;

    this.rewire();
  }

  /** Replace internal state with a new snapshot, applying smoothing where it matters. */
  setState(next: Partial<CompState>): void {
    const merged = withCompDefaults({ ...this.state, ...next });
    const bypassChanged = merged.bypass !== this.state.bypass;
    this.state = merged;
    const t = this.ctx.currentTime;
    this.comp.threshold.setTargetAtTime(merged.threshold, t, 0.01);
    this.comp.ratio.setTargetAtTime(merged.ratio, t, 0.01);
    this.comp.attack.setTargetAtTime(merged.attack, t, 0.01);
    this.comp.release.setTargetAtTime(merged.release, t, 0.01);
    this.comp.knee.setTargetAtTime(merged.knee, t, 0.01);
    this.makeup.gain.setTargetAtTime(merged.makeup, t, 0.01);
    if (bypassChanged) this.rewire();
  }

  getState(): CompState { return { ...this.state }; }

  /** Read-only compression reduction (dB, negative). Useful for a future GR meter. */
  getReduction(): number { return this.comp.reduction; }

  private rewire(): void {
    this.input.disconnect();
    try { this.comp.disconnect(); } catch { /* not yet connected */ }
    try { this.makeup.disconnect(); } catch { /* idem */ }
    if (this.state.bypass) {
      this.input.connect(this.output);
    } else {
      this.input.connect(this.comp).connect(this.makeup).connect(this.output);
    }
  }
}
