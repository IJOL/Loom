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

export class FxBus {
  reverbInput: GainNode;
  delayInput: GainNode;

  private conv: ConvolverNode;
  private revWet: GainNode;
  private revPredelay: DelayNode;
  private delay: DelayNode;
  private dlyFeedback: GainNode;
  private dlyFbFilter: BiquadFilterNode;
  private dlyWet: GainNode;
  private revSize = 2.5;
  private revDecay = 3;

  constructor(private ctx: AudioContext, private output: AudioNode) {
    // Reverb chain: reverbInput → predelay → convolver → wet → output
    this.reverbInput = ctx.createGain();
    this.revPredelay = ctx.createDelay(0.5);
    this.revPredelay.delayTime.value = 0;
    this.conv = ctx.createConvolver();
    this.conv.buffer = makeImpulse(ctx, this.revSize, this.revDecay);
    this.revWet = ctx.createGain();
    this.revWet.gain.value = 0.9;
    this.reverbInput.connect(this.revPredelay).connect(this.conv).connect(this.revWet).connect(output);

    // Delay chain with low-pass in the feedback loop for a darker tail.
    this.delayInput = ctx.createGain();
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.375;
    this.dlyFeedback = ctx.createGain();
    this.dlyFeedback.gain.value = 0.45;
    this.dlyFbFilter = ctx.createBiquadFilter();
    this.dlyFbFilter.type = 'lowpass';
    this.dlyFbFilter.frequency.value = 4500;
    this.dlyWet = ctx.createGain();
    this.dlyWet.gain.value = 0.8;
    this.delayInput.connect(this.delay);
    this.delay.connect(this.dlyFbFilter).connect(this.dlyFeedback).connect(this.delay);
    this.delay.connect(this.dlyWet).connect(output);
  }

  // ── Reverb controls ──────────────────────────────────────────────────
  setReverbWet(g: number)       { this.revWet.gain.value = g; }
  setReverbPredelay(sec: number){ this.revPredelay.delayTime.setTargetAtTime(sec, this.ctx.currentTime, 0.01); }
  setReverbSize(sec: number, decay = this.revDecay) {
    this.revSize = sec;
    this.revDecay = decay;
    this.conv.buffer = makeImpulse(this.ctx, sec, decay);
  }
  setReverbDecay(d: number) { this.setReverbSize(this.revSize, d); }
  getReverbWet() { return this.revWet.gain.value; }
  getReverbSize() { return this.revSize; }
  getReverbDecay() { return this.revDecay; }
  getReverbPredelay() { return this.revPredelay.delayTime.value; }

  // ── Delay controls ───────────────────────────────────────────────────
  setDelayTime(sec: number)      { this.delay.delayTime.setTargetAtTime(sec, this.ctx.currentTime, 0.01); }
  setDelayFeedback(g: number)    { this.dlyFeedback.gain.value = g; }
  setDelayWet(g: number)         { this.dlyWet.gain.value = g; }
  setDelayDamping(hz: number)    { this.dlyFbFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.01); }
  getDelayFeedback() { return this.dlyFeedback.gain.value; }
  getDelayWet() { return this.dlyWet.gain.value; }
  getDelayDamping() { return this.dlyFbFilter.frequency.value; }

  setBpmSync(bpm: number, beatFraction = 0.375) {
    const seconds = (60 / bpm) * beatFraction * 4;
    this.setDelayTime(seconds);
  }
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
  reverbSend: number;
  delaySend: number;
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
  reverbSend: GainNode;
  delaySend: GainNode;
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
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0;
    this.delaySend  = ctx.createGain(); this.delaySend.gain.value = 0;

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
    this.duckGain.connect(this.reverbSend).connect(fx.reverbInput);
    this.duckGain.connect(this.delaySend ).connect(fx.delayInput);

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

  setLevel(g: number)        { this.level.gain.value       = g; }
  setReverbSend(g: number)   { this.reverbSend.gain.value  = g; }
  setDelaySend (g: number)   { this.delaySend.gain.value   = g; }

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
  }

  serialize(): ChannelState {
    return {
      level: this.level.gain.value,
      pan: this.panner.pan.value,
      reverbSend: this.reverbSend.gain.value,
      delaySend: this.delaySend.gain.value,
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
    this.setReverbSend(s.reverbSend);
    this.setDelaySend(s.delaySend);
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

function makeImpulse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * Math.max(0.05, durationSec));
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}
