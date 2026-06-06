// MasterBusStrip — the master bus's own EQ + pan + mute, mirroring the lane
// ChannelStrip's tone controls so the master mixer module has the SAME controls
// as a lane column. Deliberately LIGHTER than ChannelStrip: no sends (the master
// can't send to its own reverb/delay returns — that would feed back), no
// compressor (the master already has its own MasterCompressor downstream), and
// no sidechain. The master fader/level stays the existing #volume control (set
// on the master GainNode upstream), so this strip only adds EQ/pan/mute.
//
// Signal: input → eqLow(lowshelf) → eqMid(peaking) → eqHigh(highshelf)
//               → pan(StereoPanner) → mute(gain) → output
// (EQ frequencies/types are identical to ChannelStrip for true parity.)

export interface MasterBusState {
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  pan: number;     // -1 (L) .. +1 (R)
  muted: boolean;
}

export class MasterBusStrip {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;
  private readonly panner: StereoPannerNode;
  private readonly muteGain: GainNode;
  private _muted = false;
  private _meter: AnalyserNode | null = null;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';   this.eqLow.frequency.value = 200;  this.eqLow.gain.value = 0;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';    this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 1; this.eqMid.gain.value = 0;
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 4500; this.eqHigh.gain.value = 0;
    this.panner = ctx.createStereoPanner(); this.panner.pan.value = 0;
    this.muteGain = ctx.createGain(); this.muteGain.gain.value = 1;
    this.output = ctx.createGain();

    this.input
      .connect(this.eqLow)
      .connect(this.eqMid)
      .connect(this.eqHigh)
      .connect(this.panner)
      .connect(this.muteGain)
      .connect(this.output);
  }

  setEqLow(db: number)  { this.eqLow.gain.value  = db; }
  setEqMid(db: number)  { this.eqMid.gain.value  = db; }
  setEqHigh(db: number) { this.eqHigh.gain.value = db; }
  getEqLow()  { return this.eqLow.gain.value; }
  getEqMid()  { return this.eqMid.gain.value; }
  getEqHigh() { return this.eqHigh.gain.value; }

  setPan(p: number) { this.panner.pan.setTargetAtTime(p, this.ctx.currentTime, 0.01); }
  getPan(): number  { return this.panner.pan.value; }

  setMuted(m: boolean) { this._muted = m; this.muteGain.gain.value = m ? 0 : 1; }
  isMuted(): boolean   { return this._muted; }

  /** Lazily-created post-mute meter tap (fftSize 512), mirroring ChannelStrip's
   *  getMeterAnalyser so the master VU reflects EQ + mute like a lane VU. */
  getMeterAnalyser(): AnalyserNode {
    if (!this._meter) {
      this._meter = this.ctx.createAnalyser();
      this._meter.fftSize = 512;
      this._meter.smoothingTimeConstant = 0;
      this.muteGain.connect(this._meter);
    }
    return this._meter;
  }

  serialize(): MasterBusState {
    return {
      eqLow: this.eqLow.gain.value,
      eqMid: this.eqMid.gain.value,
      eqHigh: this.eqHigh.gain.value,
      pan: this.panner.pan.value,
      muted: this._muted,
    };
  }

  restore(s: Partial<MasterBusState> | undefined | null): void {
    if (!s) return;
    if (typeof s.eqLow === 'number')  this.setEqLow(s.eqLow);
    if (typeof s.eqMid === 'number')  this.setEqMid(s.eqMid);
    if (typeof s.eqHigh === 'number') this.setEqHigh(s.eqHigh);
    if (typeof s.pan === 'number')    this.setPan(s.pan);
    if (typeof s.muted === 'boolean') this.setMuted(s.muted);
  }
}
