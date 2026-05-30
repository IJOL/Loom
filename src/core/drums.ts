// Synthesized drum machine voices (no samples). Each kit is a bag of
// parameters that drives the same set of synthesis primitives — adding a new
// "model" means tweaking numbers, not writing new DSP.
//
// Every voice routes through a per-voice ChannelStrip (EQ + sends + mute +
// level). The DrumMachine owns the strips; main.ts wires them to the UI.

import { ChannelStrip, FxBus } from './fx';

export type DrumVoice =
  | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'clap' | 'cowbell' | 'tom' | 'ride';

export const DRUM_LANES: DrumVoice[] = [
  'kick', 'snare', 'closedHat', 'openHat', 'clap', 'cowbell', 'tom', 'ride',
];

interface KickParams    { startFreq: number; endFreq: number; pitchDecay: number; ampDecay: number; clickAmount: number; tone: OscillatorType; }
interface SnareParams   { tone1: number; tone2: number; toneDecay: number; toneAmount: number; noiseAmount: number; noiseDecay: number; noiseFilter: number; }
interface HatParams     { decay: number; openDecay: number; tune: number; }
interface ClapParams    { decay: number; filterFreq: number; filterQ: number; }
interface CowbellParams { freq1: number; freq2: number; decay: number; }
interface TomParams     { startFreq: number; endFreq: number; pitchDecay: number; ampDecay: number; }
interface RideParams    { tune: number; decay: number; }

interface Kit {
  id: string;
  name: string;
  description: string;
  kick: KickParams;
  snare: SnareParams;
  hat: HatParams;
  clap: ClapParams;
  cowbell: CowbellParams;
  tom: TomParams;
  ride: RideParams;
}

const KITS: Kit[] = [
  {
    id: '808', name: 'TR-808', description: 'Warm, boomy — hip hop / electro',
    kick:    { startFreq: 150, endFreq: 50, pitchDecay: 0.05, ampDecay: 0.9, clickAmount: 0.2, tone: 'sine' },
    snare:   { tone1: 200, tone2: 330, toneDecay: 0.06, toneAmount: 0.55, noiseAmount: 0.55, noiseDecay: 0.16, noiseFilter: 4000 },
    hat:     { decay: 0.05, openDecay: 0.4, tune: 1.0 },
    clap:    { decay: 0.22, filterFreq: 1200, filterQ: 1.5 },
    cowbell: { freq1: 540, freq2: 800, decay: 0.3 },
    tom:     { startFreq: 170, endFreq: 85, pitchDecay: 0.1, ampDecay: 0.6 },
    ride:    { tune: 1.4, decay: 1.5 },
  },
  {
    id: '909', name: 'TR-909', description: 'Punchy, electronic — house / techno',
    kick:    { startFreq: 220, endFreq: 55, pitchDecay: 0.03, ampDecay: 0.4, clickAmount: 0.7, tone: 'sine' },
    snare:   { tone1: 240, tone2: 360, toneDecay: 0.04, toneAmount: 0.35, noiseAmount: 0.75, noiseDecay: 0.18, noiseFilter: 7000 },
    hat:     { decay: 0.06, openDecay: 0.35, tune: 1.2 },
    clap:    { decay: 0.16, filterFreq: 1500, filterQ: 2.0 },
    cowbell: { freq1: 587, freq2: 845, decay: 0.25 },
    tom:     { startFreq: 200, endFreq: 95, pitchDecay: 0.08, ampDecay: 0.5 },
    ride:    { tune: 1.5, decay: 1.2 },
  },
  {
    id: '606', name: 'TR-606', description: 'Small, snappy — pairs with 303',
    kick:    { startFreq: 130, endFreq: 60, pitchDecay: 0.04, ampDecay: 0.3, clickAmount: 0.4, tone: 'triangle' },
    snare:   { tone1: 260, tone2: 390, toneDecay: 0.03, toneAmount: 0.3, noiseAmount: 0.7, noiseDecay: 0.1, noiseFilter: 5500 },
    hat:     { decay: 0.04, openDecay: 0.25, tune: 1.35 },
    clap:    { decay: 0.12, filterFreq: 1400, filterQ: 1.8 },
    cowbell: { freq1: 600, freq2: 880, decay: 0.2 },
    tom:     { startFreq: 220, endFreq: 130, pitchDecay: 0.05, ampDecay: 0.3 },
    ride:    { tune: 1.4, decay: 0.8 },
  },
  {
    id: '78', name: 'CR-78', description: 'Vintage preset — mellow disco',
    kick:    { startFreq: 130, endFreq: 55, pitchDecay: 0.06, ampDecay: 0.5, clickAmount: 0.1, tone: 'sine' },
    snare:   { tone1: 180, tone2: 280, toneDecay: 0.06, toneAmount: 0.6, noiseAmount: 0.4, noiseDecay: 0.18, noiseFilter: 3500 },
    hat:     { decay: 0.06, openDecay: 0.45, tune: 0.85 },
    clap:    { decay: 0.22, filterFreq: 1000, filterQ: 1.2 },
    cowbell: { freq1: 520, freq2: 770, decay: 0.32 },
    tom:     { startFreq: 170, endFreq: 90, pitchDecay: 0.1, ampDecay: 0.55 },
    ride:    { tune: 1.3, decay: 1.2 },
  },
  {
    id: 'linn', name: 'LinnDrum', description: 'Hybrid, 80s pop punch',
    kick:    { startFreq: 180, endFreq: 60, pitchDecay: 0.04, ampDecay: 0.45, clickAmount: 0.5, tone: 'sine' },
    snare:   { tone1: 210, tone2: 320, toneDecay: 0.05, toneAmount: 0.45, noiseAmount: 0.6, noiseDecay: 0.14, noiseFilter: 5000 },
    hat:     { decay: 0.05, openDecay: 0.32, tune: 1.1 },
    clap:    { decay: 0.18, filterFreq: 1300, filterQ: 1.6 },
    cowbell: { freq1: 560, freq2: 820, decay: 0.28 },
    tom:     { startFreq: 190, endFreq: 90, pitchDecay: 0.08, ampDecay: 0.45 },
    ride:    { tune: 1.5, decay: 1.0 },
  },
];

const BY_ID: Record<string, Kit> = Object.fromEntries(KITS.map((k) => [k.id, k]));

/** Returns the static kit list without needing a DrumMachine instance.
 *  Phase G: used by main.ts to populate the kit selector at boot before
 *  lane allocation (applyLoadedSessionState) has run. */
export function listDrumKits(): Array<{ id: string; name: string; description: string }> {
  return KITS.map((k) => ({ id: k.id, name: k.name, description: k.description }));
}

export class DrumMachine {
  private noiseBuffer: AudioBuffer;
  kitId: string = '909';
  channels: Record<DrumVoice, ChannelStrip>;

  constructor(private ctx: AudioContext, fx: FxBus, dryDest: AudioNode) {
    this.noiseBuffer = makeWhiteNoise(ctx, 2);
    this.channels = Object.fromEntries(
      DRUM_LANES.map((lane) => [lane, new ChannelStrip(ctx, dryDest, fx)]),
    ) as Record<DrumVoice, ChannelStrip>;
  }

  listKits() {
    return KITS.map((k) => ({ id: k.id, name: k.name, description: k.description }));
  }

  setKit(id: string) {
    if (BY_ID[id]) this.kitId = id;
  }

  trigger(voice: DrumVoice, time: number, accent = false) {
    const kit = BY_ID[this.kitId];
    const vel = accent ? 1.0 : 0.65;
    switch (voice) {
      case 'kick':      this.playKick(kit.kick, time, vel); break;
      case 'snare':     this.playSnare(kit.snare, time, vel); break;
      case 'closedHat': this.playHat(kit.hat, time, vel, false, 'closedHat'); break;
      case 'openHat':   this.playHat(kit.hat, time, vel, true,  'openHat'); break;
      case 'clap':      this.playClap(kit.clap, time, vel); break;
      case 'cowbell':   this.playCowbell(kit.cowbell, time, vel); break;
      case 'tom':       this.playTom(kit.tom, time, vel); break;
      case 'ride':      this.playRide(kit.ride, time, vel); break;
    }
  }

  private playKick(p: KickParams, time: number, vel: number) {
    const dest = this.channels.kick.input;

    const osc = this.ctx.createOscillator();
    osc.type = p.tone;
    osc.frequency.setValueAtTime(p.startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(p.endFreq, time + p.pitchDecay);

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 1.2, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + p.ampDecay);

    osc.connect(amp).connect(dest);
    osc.start(time);
    osc.stop(time + p.ampDecay + 0.05);

    if (p.clickAmount > 0) {
      const click = this.ctx.createOscillator();
      click.type = 'square';
      click.frequency.value = 1500;
      const clickAmp = this.ctx.createGain();
      clickAmp.gain.setValueAtTime(vel * p.clickAmount * 0.5, time);
      clickAmp.gain.exponentialRampToValueAtTime(0.001, time + 0.008);
      click.connect(clickAmp).connect(dest);
      click.start(time);
      click.stop(time + 0.015);
    }
  }

  private playSnare(p: SnareParams, time: number, vel: number) {
    const dest = this.channels.snare.input;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'triangle'; osc2.type = 'triangle';
    osc1.frequency.value = p.tone1;
    osc2.frequency.value = p.tone2;
    const toneAmp = this.ctx.createGain();
    toneAmp.gain.setValueAtTime(vel * p.toneAmount, time);
    toneAmp.gain.exponentialRampToValueAtTime(0.001, time + p.toneDecay);
    osc1.connect(toneAmp);
    osc2.connect(toneAmp);
    toneAmp.connect(dest);
    osc1.start(time); osc2.start(time);
    osc1.stop(time + p.toneDecay + 0.05);
    osc2.stop(time + p.toneDecay + 0.05);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = p.noiseFilter;
    const noiseAmp = this.ctx.createGain();
    noiseAmp.gain.setValueAtTime(vel * p.noiseAmount, time);
    noiseAmp.gain.exponentialRampToValueAtTime(0.001, time + p.noiseDecay);
    noise.connect(hp).connect(noiseAmp).connect(dest);
    noise.start(time);
    noise.stop(time + p.noiseDecay + 0.05);
  }

  // Six square waves at inharmonic ratios — classic TR-808/909 hat recipe.
  private playHat(p: HatParams, time: number, vel: number, open: boolean, voice: 'closedHat' | 'openHat') {
    const dest = this.channels[voice].input;
    const baseFreqs = [205, 304, 369, 522, 540, 800];
    const decay = open ? p.openDecay : p.decay;

    const merger = this.ctx.createGain();
    merger.gain.value = 0.25;
    for (const f of baseFreqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f * p.tune;
      osc.connect(merger);
      osc.start(time);
      osc.stop(time + decay + 0.05);
    }

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 10000;
    bp.Q.value = 0.6;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + decay);
    merger.connect(bp).connect(hp).connect(amp).connect(dest);
  }

  private playClap(p: ClapParams, time: number, vel: number) {
    const dest = this.channels.clap.input;
    const offsets = [0, 0.011, 0.022, 0.033];
    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      const isLast = i === offsets.length - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = p.filterFreq;
      bp.Q.value = p.filterQ;
      const amp = this.ctx.createGain();
      const v = isLast ? vel : vel * 0.6;
      const d = isLast ? p.decay : 0.008;
      amp.gain.setValueAtTime(v, time + off);
      amp.gain.exponentialRampToValueAtTime(0.001, time + off + d);
      noise.connect(bp).connect(amp).connect(dest);
      noise.start(time + off);
      noise.stop(time + off + d + 0.05);
    }
  }

  private playCowbell(p: CowbellParams, time: number, vel: number) {
    const dest = this.channels.cowbell.input;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'square'; osc2.type = 'square';
    osc1.frequency.value = p.freq1;
    osc2.frequency.value = p.freq2;
    const merger = this.ctx.createGain();
    merger.gain.value = 0.4;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (p.freq1 + p.freq2) / 2;
    bp.Q.value = 1.5;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.45, time);
    amp.gain.linearRampToValueAtTime(vel * 0.55, time + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.001, time + p.decay);
    osc1.connect(merger); osc2.connect(merger);
    merger.connect(bp).connect(amp).connect(dest);
    osc1.start(time); osc2.start(time);
    osc1.stop(time + p.decay + 0.05);
    osc2.stop(time + p.decay + 0.05);
  }

  private playTom(p: TomParams, time: number, vel: number) {
    const dest = this.channels.tom.input;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(p.endFreq, time + p.pitchDecay);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 1.0, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + p.ampDecay);
    osc.connect(amp).connect(dest);
    osc.start(time);
    osc.stop(time + p.ampDecay + 0.05);
  }

  // Ride: shimmering metallic — like a long open hat with different inharmonic freqs
  private playRide(p: RideParams, time: number, vel: number) {
    const dest = this.channels.ride.input;
    const freqs = [284, 372, 504, 712, 858, 1057];
    const merger = this.ctx.createGain();
    merger.gain.value = 0.18;
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f * p.tune;
      osc.connect(merger);
      osc.start(time);
      osc.stop(time + p.decay + 0.05);
    }
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5500;
    bp.Q.value = 0.5;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.7, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + p.decay);
    merger.connect(bp).connect(hp).connect(amp).connect(dest);
  }
}

function makeWhiteNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
