// The master finishing stage: air, multiband glue, and stereo width.
//
// Ported from mpump (AGPL-3.0-or-later, gdamdam), where all three are FIXED and
// unreachable — its air shelf is a hardcoded −3 dB with no control at all. Here
// every one of them is a knob, because a sound parameter with no surface is a
// parameter you cannot undo. Defaults reproduce mpump's shipped voicing.
//
//   input → air (high shelf 10 kHz) → multiband glue ─┬→ output
//                                                     └→ Haas width (additive)
//
// The multiband path is always BUILT and crossfaded rather than rewired, so
// toggling it cannot click. That costs three compressors' worth of idle CPU on
// the master bus — one bus, not per lane.
export interface MasterShaperState {
  /** High shelf at 10 kHz, in dB. Negative tames hard resonance peaks. */
  airDb: number;
  /** Haas stereo widening, 0..1. 0 is untouched mono-compatible output. */
  width: number;
  /** Multiband glue compression across three bands. */
  mbOn: boolean;
  /** How hard the multiband works, 0..1. */
  mbAmount: number;
}

export const MASTER_SHAPER_DEFAULTS: MasterShaperState = {
  airDb: -3,      // mpump ships this fixed; here it is merely the default
  width: 0,       // the master stays transparent until asked
  mbOn: false,
  mbAmount: 0.25,
};

/** Crossover frequencies for the three glue bands. */
const XOVER_LOW = 200;
const XOVER_HIGH = 3000;

/** Per-band compressor voicing (threshold dB, ratio, attack s). The low band
 *  gets the slowest attack so kick transients survive; the high band the
 *  fastest, because that is where harshness lives. */
const BANDS = [
  { threshold: -9,  ratio: 2.5, attack: 0.020 },
  { threshold: -15, ratio: 2.5, attack: 0.005 },
  { threshold: -12, ratio: 3.0, attack: 0.003 },
];

export class MasterShaper {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly air: BiquadFilterNode;
  private readonly mbDry: GainNode;
  private readonly mbWet: GainNode;
  private readonly comps: DynamicsCompressorNode[] = [];
  private readonly widthGain: GainNode;
  private state: MasterShaperState = { ...MASTER_SHAPER_DEFAULTS };

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // ── Air ─────────────────────────────────────────────────────────────────
    this.air = ctx.createBiquadFilter();
    this.air.type = 'highshelf';
    this.air.frequency.value = 10000;
    this.air.gain.value = MASTER_SHAPER_DEFAULTS.airDb;
    this.input.connect(this.air);

    // ── Multiband glue, built in parallel with a dry path ───────────────────
    this.mbDry = ctx.createGain();
    this.mbWet = ctx.createGain();
    this.mbDry.gain.value = 1;
    this.mbWet.gain.value = 0;
    this.air.connect(this.mbDry).connect(this.output);

    const mbSum = ctx.createGain();
    // Low band: everything under the low crossover.
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = XOVER_LOW;
    // High band: everything above the high crossover.
    const high = ctx.createBiquadFilter();
    high.type = 'highpass'; high.frequency.value = XOVER_HIGH;
    this.air.connect(low);
    this.air.connect(high);

    // Mid band by SUBTRACTION — signal minus the two outer bands — rather than
    // a second pair of filters. Bandpass filters are not complementary to their
    // neighbours: summing three independently-filtered bands comb-filters at the
    // crossovers and RAISES crest factor instead of gluing. Subtraction
    // reconstructs the input exactly when the compressors are idle, which is the
    // property a glue stage must have.
    const mid = ctx.createGain();
    const negLow = ctx.createGain();  negLow.gain.value = -1;
    const negHigh = ctx.createGain(); negHigh.gain.value = -1;
    this.air.connect(mid);
    low.connect(negLow).connect(mid);
    high.connect(negHigh).connect(mid);

    const bandOuts: AudioNode[] = [low, mid, high];

    bandOuts.forEach((band, i) => {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = BANDS[i].threshold;
      c.ratio.value = BANDS[i].ratio;
      c.attack.value = BANDS[i].attack;
      c.release.value = 0.25;
      c.knee.value = 6;
      band.connect(c).connect(mbSum);
      this.comps.push(c);
    });
    mbSum.connect(this.mbWet).connect(this.output);

    // ── Haas width, summed ON TOP of the main signal ────────────────────────
    // Only the highs are widened: delaying bass smears the low end and wrecks
    // mono compatibility, which is why the tap is high-passed first.
    const widthHp = ctx.createBiquadFilter();
    widthHp.type = 'highpass';
    widthHp.frequency.value = 3000;
    this.air.connect(widthHp);

    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.0004;          // 0.4 ms — the Haas fusion zone
    const panLate = ctx.createStereoPanner();
    panLate.pan.value = 0.6;
    const panEarly = ctx.createStereoPanner();
    panEarly.pan.value = -0.3;

    this.widthGain = ctx.createGain();
    this.widthGain.gain.value = 0;           // width 0 → the branch is silent
    widthHp.connect(delay).connect(panLate).connect(this.widthGain);
    widthHp.connect(panEarly).connect(this.widthGain);
    this.widthGain.connect(this.output);
  }

  setAirDb(db: number): void {
    this.state.airDb = db;
    this.air.gain.value = db;
  }

  setWidth(w: number): void {
    this.state.width = w;
    // 0.7 compensates the ~3 dB the Haas pair adds when it sums back in.
    this.widthGain.gain.value = w * 0.7;
  }

  setMultibandOn(on: boolean): void {
    this.state.mbOn = on;
    this.mbWet.gain.value = on ? 1 : 0;
    this.mbDry.gain.value = on ? 0 : 1;
  }

  /** Scale how hard the glue works. At 0 the thresholds sit high enough and the
   *  ratios near enough to 1:1 that the band compressors are effectively idle. */
  setMultibandAmount(a: number): void {
    this.state.mbAmount = a;
    this.comps.forEach((c, i) => {
      const b = BANDS[i];
      c.threshold.value = b.threshold * a;
      c.ratio.value = 1 + (b.ratio - 1) * a;
    });
  }

  getState(): MasterShaperState { return { ...this.state }; }

  setState(s: Partial<MasterShaperState>): void {
    const next = { ...MASTER_SHAPER_DEFAULTS, ...this.state, ...s };
    this.setAirDb(next.airDb);
    this.setWidth(next.width);
    this.setMultibandAmount(next.mbAmount);
    this.setMultibandOn(next.mbOn);
  }

  dispose(): void {
    for (const n of [this.input, this.output, this.air, this.mbDry, this.mbWet, this.widthGain, ...this.comps]) {
      try { n.disconnect(); } catch { /* ok */ }
    }
  }
}
