// Master FX bus (reverb + delay) and per-voice ChannelStrip (EQ + sends + mute + level).
// Also a `FilterChain` of stackable filters on the master output, each with
// optional BPM-synced LFO modulating its cutoff.

import { CompBlock } from './comp-block';
import {
  withCompDefaults,
  withSidechainDefaultsOrNull,
  type CompState,
  type SidechainState,
} from './comp-state';
import { DuckerSubgraph } from './ducker-subgraph';
import { SidechainBus } from './sidechain-bus';
import { SendBus } from './send-bus';
import { createInstance } from '../plugins/registry';

// FxBus is the FX send bank: two generic send buses, A (seeded Delay) and B
// (seeded Reverb). Kept under the name `FxBus` to bound blast radius; it is no
// longer a privileged reverb+delay pair — reverb/delay are ordinary inserts
// living in the bus insert chains. `reverbInput`/`delayInput` alias the bus
// inputs so ChannelStrip and DrumMachine per-voice sends route unchanged.
export class FxBus {
  readonly sends: SendBus[];

  constructor(ctx: AudioContext, output: AudioNode) {
    const a = new SendBus(ctx, 'A', 'Send A (Delay)', output);
    const b = new SendBus(ctx, 'B', 'Send B (Reverb)', output);
    // Seed each bus with its default insert. createInstance returns undefined
    // when the registry isn't bootstrapped (e.g. pure unit tests) — the chain
    // stays empty (pass-through) and the shims below no-op.
    const delay  = createInstance('fx', 'delay',  ctx);
    const reverb = createInstance('fx', 'reverb', ctx);
    if (delay)  a.inserts.insert(delay);
    if (reverb) b.inserts.insert(reverb);
    this.sends = [a, b];
  }

  getSendBus(id: 'A' | 'B'): SendBus {
    const s = this.sends.find((x) => x.id === id);
    if (!s) throw new Error(`FxBus: unknown send bus "${id}"`);
    return s;
  }

  get reverbInput(): GainNode { return this.getSendBus('B').input; }
  get delayInput(): GainNode  { return this.getSendBus('A').input; }

  // ── Transitional shims (removed in Task 12 once fx-ui/modulation-ui migrate).
  // They drive the seeded reverb (bus B) / delay (bus A) inserts directly.
  private seed(id: 'A' | 'B') { return this.getSendBus(id).inserts.list()[0]?.fx; }
  setReverbWet(g: number)        { this.seed('B')?.setBaseValue('wet', g); }
  setReverbPredelay(sec: number) { this.seed('B')?.setBaseValue('predelay', sec); }
  setReverbSize(sec: number, decay?: number) { this.seed('B')?.setBaseValue('size', sec); if (decay !== undefined) this.seed('B')?.setBaseValue('decay', decay); }
  setReverbDecay(d: number)      { this.seed('B')?.setBaseValue('decay', d); }
  getReverbWet()      { return this.seed('B')?.getBaseValue('wet') ?? 0; }
  getReverbSize()     { return this.seed('B')?.getBaseValue('size') ?? 0; }
  getReverbDecay()    { return this.seed('B')?.getBaseValue('decay') ?? 0; }
  getReverbPredelay() { return this.seed('B')?.getBaseValue('predelay') ?? 0; }
  setDelayTime(sec: number)   { this.seed('A')?.setBaseValue('time', sec); }
  setDelayFeedback(g: number) { this.seed('A')?.setBaseValue('feedback', g); }
  setDelayWet(g: number)      { this.seed('A')?.setBaseValue('wet', g); }
  setDelayDamping(hz: number) { this.seed('A')?.setBaseValue('damping', hz); }
  getDelayFeedback() { return this.seed('A')?.getBaseValue('feedback') ?? 0; }
  getDelayWet()      { return this.seed('A')?.getBaseValue('wet') ?? 0; }
  getDelayDamping()  { return this.seed('A')?.getBaseValue('damping') ?? 0; }
  setBpmSync(bpm: number, beatFraction = 0.375) { this.setDelayTime((60 / bpm) * beatFraction * 4); }
  getMasterSendInstances() { return { reverb: this.seed('B'), delay: this.seed('A') }; }
}

export interface SidechainRegistration {
  bus: SidechainBus;
  id: string;
  label: string;
}

export interface ChannelStripOptions {
  sidechain?: SidechainRegistration;
}

export interface ChannelState {
  level: number;
  pan: number;        // -1 (L) .. +1 (R)
  sendA: number;      // Send A → Delay bus
  sendB: number;      // Send B → Reverb bus
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  muted: boolean;
  comp: CompState;
  sidechain: SidechainState | null;
}

export class ChannelStrip {
  input: GainNode;
  level: GainNode;
  sendA: GainNode;
  sendB: GainNode;
  comp: CompBlock;
  sidechainTap: GainNode;
  private duckGain: GainNode;
  private ducker: DuckerSubgraph | null = null;
  private sidechainState: SidechainState | null = null;
  private bus: SidechainBus | null = null;
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private panner: StereoPannerNode;
  private muteGain: GainNode;
  private _muted = false;
  private busRegistration: { bus: SidechainBus; id: string } | null = null;
  private _meterAnalyser: AnalyserNode | null = null;

  constructor(
    private ctx: AudioContext,
    dry: AudioNode,
    fx: FxBus,
    opts: ChannelStripOptions = {},
  ) {
    this.input = ctx.createGain();
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';  this.eqLow.frequency.value = 200;  this.eqLow.gain.value = 0;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';   this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 1; this.eqMid.gain.value = 0;
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 4500; this.eqHigh.gain.value = 0;
    this.level    = ctx.createGain(); this.level.gain.value = 1;
    this.panner   = ctx.createStereoPanner(); this.panner.pan.value = 0;
    this.muteGain = ctx.createGain(); this.muteGain.gain.value = 1;
    this.sendA = ctx.createGain(); this.sendA.gain.value = 0;
    this.sendB = ctx.createGain(); this.sendB.gain.value = 0;

    // EQ → comp → level → pan → mute → {dry, sends}
    this.comp = new CompBlock(ctx);

    this.input
      .connect(this.eqLow)
      .connect(this.eqMid)
      .connect(this.eqHigh)
      .connect(this.comp.input);
    this.comp.output
      .connect(this.level)
      .connect(this.panner)
      .connect(this.muteGain);
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;
    this.muteGain.connect(this.duckGain);
    this.duckGain.connect(dry);
    this.duckGain.connect(this.sendA).connect(fx.delayInput);   // Send A → Delay bus
    this.duckGain.connect(this.sendB).connect(fx.reverbInput);  // Send B → Reverb bus

    // Post-mute fan-out tap for sidechain consumers. Connected to muteGain
    // (pre-duck) so a lane's outgoing tap reflects pre-duck signal — avoids
    // a lane ducking itself via feedback.
    this.sidechainTap = ctx.createGain();
    this.muteGain.connect(this.sidechainTap);

    if (opts.sidechain) {
      opts.sidechain.bus.register(opts.sidechain.id, this.sidechainTap, opts.sidechain.label);
      this.bus = opts.sidechain.bus;
      this.busRegistration = { bus: opts.sidechain.bus, id: opts.sidechain.id };
    }
  }

  setPan(p: number) { this.panner.pan.setTargetAtTime(p, this.panner.context.currentTime, 0.01); }
  getPan(): number  { return this.panner.pan.value; }
  /** Canonical StereoPanner pan AudioParam — for modulation routing. */
  getPanParam(): AudioParam { return this.panner.pan; }

  /**
   * Lazy-allocate an AnalyserNode tapped from `muteGain` (post-pan, post-mute,
   * pre-duck). The analyser is created on first call and reused thereafter.
   * Suitable for driving a VU meter that shows what the listener hears without
   * being affected by sidechain ducking feedback loops.
   *
   * fftSize = 512 (→ 256-sample time-domain buffer ≈ 5.8 ms @ 44.1 kHz).
   * smoothingTimeConstant = 0 (RMS computed in RAF loop, not smoothed here).
   */
  getMeterAnalyser(): AnalyserNode {
    if (!this._meterAnalyser) {
      this._meterAnalyser = this.ctx.createAnalyser();
      this._meterAnalyser.fftSize = 512;
      this._meterAnalyser.smoothingTimeConstant = 0;
      this.muteGain.connect(this._meterAnalyser);
    }
    return this._meterAnalyser;
  }

  setEqLow (db: number) { this.eqLow.gain.value  = db; }
  setEqMid (db: number) { this.eqMid.gain.value  = db; }
  setEqHigh(db: number) { this.eqHigh.gain.value = db; }

  /** Return the BiquadFilterNode gain AudioParam for the requested EQ band.
   *  Lets external code (modulation host, automation) write to the filter
   *  gain with sample-accurate scheduling — `setEqLow`/`setEqMid`/`setEqHigh`
   *  are convenience setters; `getEqGainParam` is the canonical handle. */
  getEqGainParam(band: 'low' | 'mid' | 'high'): AudioParam {
    if (band === 'low')  return this.eqLow.gain;
    if (band === 'mid')  return this.eqMid.gain;
    return this.eqHigh.gain;
  }

  setLevel(g: number)  { this.level.gain.value  = g; }
  setSendA(g: number)  { this.sendA.gain.value  = g; }
  setSendB(g: number)  { this.sendB.gain.value  = g; }

  setCompState(s: Partial<CompState>) { this.comp.setState(s); }
  getCompState(): CompState { return this.comp.getState(); }

  setSidechain(bus: SidechainBus, state: SidechainState | null): void {
    if (this.ducker) {
      this.ducker.dispose();
      this.ducker = null;
    }
    this.sidechainState = state;
    if (!state || !state.source) return;
    const sourceTap = bus.getTap(state.source);
    if (!sourceTap) {
      // Unknown source lane — leave the ducker disabled but keep the state
      // (it'll come online if the source registers later; caller re-applies).
      return;
    }
    this.ducker = new DuckerSubgraph(this.ctx, {
      sourceTap, duckGain: this.duckGain, state,
    });
  }

  getSidechain(): SidechainState | null { return this.sidechainState; }

  setMuted(m: boolean) {
    this._muted = m;
    this.muteGain.gain.value = m ? 0 : 1;
  }
  isMuted() { return this._muted; }

  /**
   * Release sidechain-side resources held by this strip: tear down the
   * ducker subgraph (if any), unregister from the SidechainBus, and
   * disconnect the sidechain tap. Does NOT tear down the strip's primary
   * audio graph (input → EQ → comp → level → pan → mute → ...) — those
   * nodes are garbage-collected when the strip becomes unreferenced.
   * Safe to call multiple times.
   */
  dispose(): void {
    if (this.ducker) {
      this.ducker.dispose();
      this.ducker = null;
    }
    if (this.busRegistration) {
      this.busRegistration.bus.unregister(this.busRegistration.id);
      this.busRegistration = null;
    }
    try { this.sidechainTap.disconnect(); } catch { /* */ }
    if (this._meterAnalyser) {
      try { this._meterAnalyser.disconnect(); } catch { /* */ }
      this._meterAnalyser = null;
    }
  }

  serialize(): ChannelState {
    return {
      level: this.level.gain.value,
      pan: this.panner.pan.value,
      sendA: this.sendA.gain.value,
      sendB: this.sendB.gain.value,
      eqLow:  this.eqLow.gain.value,
      eqMid:  this.eqMid.gain.value,
      eqHigh: this.eqHigh.gain.value,
      muted: this._muted,
      comp: this.comp.getState(),
      sidechain: this.sidechainState ? { ...this.sidechainState } : null,
    };
  }

  restore(s: ChannelState) {
    this.setLevel(s.level);
    if (typeof s.pan === 'number') this.setPan(s.pan);
    const legacy = s as ChannelState & { reverbSend?: number; delaySend?: number };
    this.setSendA(s.sendA ?? legacy.delaySend ?? 0);
    this.setSendB(s.sendB ?? legacy.reverbSend ?? 0);
    this.setEqLow(s.eqLow);
    this.setEqMid(s.eqMid);
    this.setEqHigh(s.eqHigh);
    this.setMuted(s.muted);
    this.comp.setState(withCompDefaults(s.comp));
    const sc = withSidechainDefaultsOrNull(s.sidechain);
    if (this.bus) this.setSidechain(this.bus, sc);
  }
}

// ── Master filter chain ───────────────────────────────────────────────────
// Stackable filters in series on the master output. Each filter has its own
// type/cutoff/Q and an optional BPM-synced LFO modulating its cutoff.

export type SyncDiv =
  | 'off'
  | '4/1' | '3/1' | '2/1' | '1/1'   // multi-bar / whole-note cycles
  | '1/2' | '1/4' | '1/8' | '1/8.' | '1/8t'
  | '1/16' | '1/16t' | '1/32';

const SYNC_BEATS: Record<SyncDiv, number> = {
  'off':   0,
  '4/1':   16,    // 4 whole notes = 4 bars in 4/4
  '3/1':   12,    // 3 whole notes = 3 bars
  '2/1':    8,    // 2 whole notes = 2 bars
  '1/1':    4,    // 1 whole note  = 1 bar
  '1/2':    2,
  '1/4':    1,
  '1/8':    0.5,
  '1/8.':   0.75,
  '1/8t':   1/3,
  '1/16':   0.25,
  '1/16t':  1/6,
  '1/32':   0.125,
};

// LFO cycles per second given BPM + division. E.g. '1/4' at 120 BPM = 2 cycles/sec.
export function syncDivToHz(bpm: number, div: SyncDiv): number {
  const beats = SYNC_BEATS[div];
  if (beats <= 0) return 0;
  const beatsPerSec = bpm / 60;
  return beatsPerSec / beats;
}

export interface MasterFilterState {
  type: BiquadFilterType;
  cutoff: number;
  q: number;
  lfoWave: OscillatorType;
  lfoSync: SyncDiv;
  lfoDepth: number;
  bypass: boolean;
}

export class MasterFilter {
  filter: BiquadFilterNode;
  state: MasterFilterState;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  constructor(private ctx: AudioContext) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 8000;
    this.filter.Q.value = 1;
    this.state = {
      type: 'lowpass', cutoff: 8000, q: 1,
      lfoWave: 'sine', lfoSync: 'off', lfoDepth: 0, bypass: false,
    };
  }

  setType(t: BiquadFilterType) { this.state.type = t; this.filter.type = t; }
  setCutoff(hz: number) {
    this.state.cutoff = hz;
    this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.01);
  }
  setQ(q: number) { this.state.q = q; this.filter.Q.value = q; }
  setBypass(b: boolean) {
    // Implemented at chain level via rewire; we just track state.
    this.state.bypass = b;
  }
  setLfo(wave: OscillatorType, sync: SyncDiv, depth: number, bpm: number) {
    this.state.lfoWave = wave;
    this.state.lfoSync = sync;
    this.state.lfoDepth = depth;
    this.rebuildLfo(bpm);
  }
  updateBpm(bpm: number) {
    if (this.lfo && this.state.lfoSync !== 'off') {
      const hz = syncDivToHz(bpm, this.state.lfoSync);
      this.lfo.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.01);
    }
  }
  private rebuildLfo(bpm: number) {
    if (this.lfo) {
      try { this.lfo.stop(); } catch {}
      this.lfo.disconnect();
      this.lfo = null;
    }
    if (this.lfoGain) { this.lfoGain.disconnect(); this.lfoGain = null; }
    if (this.state.lfoSync === 'off' || this.state.lfoDepth === 0) return;
    const hz = syncDivToHz(bpm, this.state.lfoSync);
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = this.state.lfoWave;
    this.lfo.frequency.value = hz;
    this.lfoGain = this.ctx.createGain();
    // Depth scales the cutoff modulation amount in Hz.
    this.lfoGain.gain.value = this.state.lfoDepth * 4000;
    this.lfo.connect(this.lfoGain).connect(this.filter.frequency);
    this.lfo.start();
  }
  dispose() {
    if (this.lfo) { try { this.lfo.stop(); } catch {} this.lfo.disconnect(); this.lfo = null; }
    if (this.lfoGain) { this.lfoGain.disconnect(); this.lfoGain = null; }
    this.filter.disconnect();
  }
}

export class FilterChain {
  filters: MasterFilter[] = [];

  constructor(private ctx: AudioContext, private input: AudioNode, private output: AudioNode) {
    // No filters yet: direct connection.
    input.connect(output);
  }

  add(): MasterFilter {
    const mf = new MasterFilter(this.ctx);
    this.filters.push(mf);
    this.rewire();
    return mf;
  }

  remove(mf: MasterFilter) {
    const idx = this.filters.indexOf(mf);
    if (idx < 0) return;
    this.filters.splice(idx, 1);
    mf.dispose();
    this.rewire();
  }

  updateBpm(bpm: number) {
    for (const mf of this.filters) mf.updateBpm(bpm);
  }

  private rewire() {
    // Disconnect everything in the chain and rebuild input → filters → output.
    this.input.disconnect();
    for (const mf of this.filters) mf.filter.disconnect();
    const active = this.filters.filter((mf) => !mf.state.bypass);
    if (active.length === 0) {
      this.input.connect(this.output);
      return;
    }
    this.input.connect(active[0].filter);
    for (let i = 0; i < active.length - 1; i++) {
      active[i].filter.connect(active[i + 1].filter);
    }
    active[active.length - 1].filter.connect(this.output);
  }
}

// ── Master compressor ────────────────────────────────────────────────────
// A thin wrapper around CompBlock used at the tail of the master chain.
// Stored separately from FilterChain so the FX page UI can address them
// independently and so bypass/serialize remain isolated.

export class MasterCompressor {
  private block: CompBlock;

  constructor(ctx: BaseAudioContext, initial?: Partial<CompState>) {
    this.block = new CompBlock(ctx, initial);
  }

  get input(): AudioNode  { return this.block.input; }
  get output(): AudioNode { return this.block.output; }

  setState(s: Partial<CompState>) { this.block.setState(s); }
  getState(): CompState           { return this.block.getState(); }
  getReduction(): number          { return this.block.getReduction(); }
}

