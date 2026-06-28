// src/core/channel-filter.ts
// Engine-owned channel low-pass filter (cutoff + resonance) for the Drums and
// Sampler engines. A plain BiquadFilter spliced on the RAW channel mix, BEFORE
// the lane InsertChain + bus ChannelStrip EQ. Cutoff modulation targets .detune
// (cents, exponential) so a bipolar LFO sweeps musically — mirrors the Filter
// insert (src/plugins/fx/multifilter.ts); the knob/automation path writes
// .frequency / .Q directly.

export const FILTER_CUTOFF_MIN = 20;
export const FILTER_CUTOFF_MAX = 20000;
export const FILTER_CUTOFF_DEFAULT = 20000;   // fully open ⇒ passthrough
export const FILTER_Q_MIN = 0.7;
export const FILTER_Q_MAX = 18;
export const FILTER_Q_DEFAULT = 0.7;           // no resonant peak

/** Full-knob exponential sweep of the cutoff in cents (20 Hz..20 kHz). */
export const FILTER_DETUNE_SPAN_CENTS = 1200 * Math.log2(FILTER_CUTOFF_MAX / FILTER_CUTOFF_MIN);

export class ChannelFilter {
  readonly node: BiquadFilterNode;
  /** Raw mix enters here; output is the biquad. */
  get input(): AudioNode { return this.node; }
  get output(): AudioNode { return this.node; }

  constructor(ctx: BaseAudioContext) {
    this.node = ctx.createBiquadFilter();
    this.node.type = 'lowpass';
    this.node.frequency.value = FILTER_CUTOFF_DEFAULT;
    this.node.Q.value = FILTER_Q_DEFAULT;
  }

  setCutoff(hz: number): void { this.node.frequency.value = hz; }
  getCutoff(): number { return this.node.frequency.value; }
  setResonance(q: number): void { this.node.Q.value = q; }
  getResonance(): number { return this.node.Q.value; }

  /** Cutoff modulation destination (cents) — see FILTER_DETUNE_SPAN_CENTS. */
  getCutoffModParam(): AudioParam { return this.node.detune; }
  /** Resonance modulation destination (linear Q). */
  getResonanceParam(): AudioParam { return this.node.Q; }

  dispose(): void { try { this.node.disconnect(); } catch { /* */ } }
}
