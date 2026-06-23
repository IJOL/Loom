// Two-pole state-variable filter (adapted from strudel dough.mjs TwoPoleFilter).
// `resonance` here is a 0..~20 scale (Loom maps its 0..1 knob to 0.5..22.5 Q).
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export class Svf {
  private s0 = 0;   // bandpass state
  private s1 = 0;   // lowpass state
  lp = 0; bp = 0; hp = 0;
  constructor(private sr: number) {}
  update(input: number, cutoffHz: number, resonance: number): void {
    const res = Math.max(resonance, 0);
    const cutoff = Math.min(cutoffHz, this.sr * 0.45);
    let c = 2 * Math.sin((cutoff * Math.PI) / this.sr);
    c = clamp(c, 0, 1.14);
    const r = Math.pow(0.5, (res + 0.125) / 0.125);
    const mrc = 1 - r * c;
    this.s0 = mrc * this.s0 - c * this.s1 + c * input;   // bandpass
    this.s1 = mrc * this.s1 + c * this.s0;               // lowpass
    this.bp = this.s0; this.lp = this.s1; this.hp = input - this.lp - r * this.bp;
  }
}
