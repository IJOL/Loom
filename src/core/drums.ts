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

export const WAVE_TYPES: OscillatorType[] = ['sine', 'triangle', 'square'];
const WAVE_INDEX: Record<string, number> = { sine: 0, triangle: 1, square: 2 };
const HAT_FILTER_DEFAULT = 7000;

/** Live, editable per-voice synthesis params. Seeded from the active kit by
 *  loadKitDefaults; read at trigger time by each play* method. Keys are the
 *  canonical leaf names documented in the plan. */
export type VoiceSynthState = Record<string, number>;
export type DrumSynthState = Record<DrumVoice, VoiceSynthState>;

function seedSynthState(kit: Kit): DrumSynthState {
  return {
    kick: {
      tune: 1, attack: kit.kick.clickAmount, decay: kit.kick.ampDecay,
      startFreq: kit.kick.startFreq, endFreq: kit.kick.endFreq,
      sweep: kit.kick.pitchDecay, wave: WAVE_INDEX[kit.kick.tone] ?? 0,
    },
    snare: {
      tune: 1, tone: kit.snare.toneAmount, snap: kit.snare.noiseAmount,
      bodyDecay: kit.snare.toneDecay, noiseDecay: kit.snare.noiseDecay,
      noiseTone: kit.snare.noiseFilter, tone1: kit.snare.tone1, tone2: kit.snare.tone2,
    },
    closedHat: { tune: kit.hat.tune, decay: kit.hat.decay,    filter: HAT_FILTER_DEFAULT },
    openHat:   { tune: kit.hat.tune, decay: kit.hat.openDecay, filter: HAT_FILTER_DEFAULT },
    clap: { tone: kit.clap.filterFreq, decay: kit.clap.decay, sharp: kit.clap.filterQ },
    tom: {
      tune: 1, decay: kit.tom.ampDecay, sweep: kit.tom.pitchDecay,
      startFreq: kit.tom.startFreq, end: kit.tom.endFreq,
    },
    cowbell: {
      tune: 1, decay: kit.cowbell.decay, detune: 1, // new param, no kit field — neutral default
      freq1: kit.cowbell.freq1, freq2: kit.cowbell.freq2,
    },
    ride: { tune: kit.ride.tune, decay: kit.ride.decay },
  };
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
  private synth: DrumSynthState;

  constructor(private ctx: AudioContext, fx: FxBus, dryDest: AudioNode) {
    this.noiseBuffer = makeWhiteNoise(ctx, 2);
    this.channels = Object.fromEntries(
      DRUM_LANES.map((lane) => [lane, new ChannelStrip(ctx, dryDest, fx)]),
    ) as Record<DrumVoice, ChannelStrip>;
    this.synth = seedSynthState(BY_ID[this.kitId]);
  }

  listKits() {
    return KITS.map((k) => ({ id: k.id, name: k.name, description: k.description }));
  }

  setKit(id: string) {
    if (BY_ID[id]) this.kitId = id;
  }

  /** Reload all per-voice synth params from a kit (the "preset of departure")
   *  AND reset every per-voice mixer strip to neutral. Distinct from setKit,
   *  which only changes the active id. */
  loadKitDefaults(id: string): void {
    const kit = BY_ID[id];
    if (!kit) return;          // unknown id — caller's mistake, don't mutate state
    this.kitId = id;
    this.synth = seedSynthState(kit);
    for (const v of DRUM_LANES) {
      const st = this.channels[v];
      st.setLevel(1); st.setPan(0); st.setReverbSend(0); st.setDelaySend(0);
      st.setEqLow(0); st.setEqMid(0); st.setEqHigh(0);
    }
  }

  setVoiceParam(voice: DrumVoice, leaf: string, value: number): void {
    const v = this.synth[voice];
    if (v) v[leaf] = value;
  }

  getVoiceParam(voice: DrumVoice, leaf: string): number | undefined {
    return this.synth[voice]?.[leaf];
  }

  trigger(voice: DrumVoice, time: number, accent = false) {
    const vel = accent ? 1.0 : 0.65;
    switch (voice) {
      case 'kick':      this.playKick(time, vel); break;
      case 'snare':     this.playSnare(time, vel); break;
      case 'closedHat': this.playHat('closedHat', time, vel); break;
      case 'openHat':   this.playHat('openHat', time, vel); break;
      case 'clap':      this.playClap(time, vel); break;
      case 'cowbell':   this.playCowbell(time, vel); break;
      case 'tom':       this.playTom(time, vel); break;
      case 'ride':      this.playRide(time, vel); break;
    }
  }

  private playKick(time: number, vel: number) {
    const s = this.synth.kick;
    const dest = this.channels.kick.input;
    const osc = this.ctx.createOscillator();
    osc.type = WAVE_TYPES[Math.round(s.wave)] ?? 'sine';
    osc.frequency.setValueAtTime(s.startFreq * s.tune, time);
    osc.frequency.exponentialRampToValueAtTime(s.endFreq * s.tune, time + s.sweep);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 1.2, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
    osc.connect(amp).connect(dest);
    osc.start(time);
    osc.stop(time + s.decay + 0.05);
    if (s.attack > 0) {
      const click = this.ctx.createOscillator();
      click.type = 'square';
      click.frequency.value = 1500;
      const clickAmp = this.ctx.createGain();
      clickAmp.gain.setValueAtTime(vel * s.attack * 0.5, time);
      clickAmp.gain.exponentialRampToValueAtTime(0.001, time + 0.008);
      click.connect(clickAmp).connect(dest);
      click.start(time);
      click.stop(time + 0.015);
    }
  }

  private playSnare(time: number, vel: number) {
    const s = this.synth.snare;
    const dest = this.channels.snare.input;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'triangle'; osc2.type = 'triangle';
    osc1.frequency.value = s.tone1 * s.tune;
    osc2.frequency.value = s.tone2 * s.tune;
    const toneAmp = this.ctx.createGain();
    toneAmp.gain.setValueAtTime(vel * s.tone, time);
    toneAmp.gain.exponentialRampToValueAtTime(0.001, time + s.bodyDecay);
    osc1.connect(toneAmp); osc2.connect(toneAmp); toneAmp.connect(dest);
    osc1.start(time); osc2.start(time);
    osc1.stop(time + s.bodyDecay + 0.05);
    osc2.stop(time + s.bodyDecay + 0.05);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    // TUNE scales the noise high-pass too (not just the masked tonal body), so
    // tuning audibly brightens/darkens the whole snare instead of doing nothing.
    hp.frequency.value = s.noiseTone * s.tune;
    const noiseAmp = this.ctx.createGain();
    noiseAmp.gain.setValueAtTime(vel * s.snap, time);
    noiseAmp.gain.exponentialRampToValueAtTime(0.001, time + s.noiseDecay);
    noise.connect(hp).connect(noiseAmp).connect(dest);
    noise.start(time);
    noise.stop(time + s.noiseDecay + 0.05);
  }

  // Six square waves at inharmonic ratios — classic TR-808/909 hat recipe.
  private playHat(voice: 'closedHat' | 'openHat', time: number, vel: number) {
    const s = this.synth[voice];
    const dest = this.channels[voice].input;
    const baseFreqs = [205, 304, 369, 522, 540, 800];
    const decay = s.decay;
    const merger = this.ctx.createGain();
    merger.gain.value = 0.25;
    for (const f of baseFreqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f * s.tune;
      osc.connect(merger);
      osc.start(time);
      osc.stop(time + decay + 0.05);
    }
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.6;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = s.filter;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + decay);
    merger.connect(bp).connect(hp).connect(amp).connect(dest);
  }

  private playClap(time: number, vel: number) {
    const s = this.synth.clap;
    const dest = this.channels.clap.input;
    const offsets = [0, 0.011, 0.022, 0.033];
    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      const isLast = i === offsets.length - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = s.tone;
      bp.Q.value = s.sharp;
      const amp = this.ctx.createGain();
      const v = isLast ? vel : vel * 0.6;
      const d = isLast ? s.decay : 0.008;
      amp.gain.setValueAtTime(v, time + off);
      amp.gain.exponentialRampToValueAtTime(0.001, time + off + d);
      noise.connect(bp).connect(amp).connect(dest);
      noise.start(time + off);
      noise.stop(time + off + d + 0.05);
    }
  }

  private playCowbell(time: number, vel: number) {
    const s = this.synth.cowbell;
    const dest = this.channels.cowbell.input;
    const f1 = s.freq1 * s.tune;
    const f2 = s.freq2 * s.tune * s.detune;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'square'; osc2.type = 'square';
    osc1.frequency.value = f1; osc2.frequency.value = f2;
    const merger = this.ctx.createGain();
    merger.gain.value = 0.4;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = (f1 + f2) / 2; bp.Q.value = 1.5;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.45, time);
    amp.gain.linearRampToValueAtTime(vel * 0.55, time + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
    osc1.connect(merger); osc2.connect(merger);
    merger.connect(bp).connect(amp).connect(dest);
    osc1.start(time); osc2.start(time);
    osc1.stop(time + s.decay + 0.05);
    osc2.stop(time + s.decay + 0.05);
  }

  private playTom(time: number, vel: number) {
    const s = this.synth.tom;
    const dest = this.channels.tom.input;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(s.startFreq * s.tune, time);
    osc.frequency.exponentialRampToValueAtTime(s.end * s.tune, time + s.sweep);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 1.0, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
    osc.connect(amp).connect(dest);
    osc.start(time);
    osc.stop(time + s.decay + 0.05);
  }

  // Ride: shimmering metallic — like a long open hat with different inharmonic freqs
  private playRide(time: number, vel: number) {
    const s = this.synth.ride;
    const dest = this.channels.ride.input;
    const freqs = [284, 372, 504, 712, 858, 1057];
    const merger = this.ctx.createGain();
    merger.gain.value = 0.18;
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f * s.tune;
      osc.connect(merger);
      osc.start(time);
      osc.stop(time + s.decay + 0.05);
    }
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 5500; bp.Q.value = 0.5;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.7, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
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
