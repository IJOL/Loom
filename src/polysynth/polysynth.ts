// Polyphonic subtractive synth — 2 oscillators + sub + noise → drive →
// multimode filter (with ADSR + key tracking) → amp (with ADSR) → output.
// Two LFOs are routable to pitch / cutoff / amp.
//
// Each `trigger()` allocates a fresh per-note voice subgraph that schedules
// the entire envelope at sample-accurate times and frees itself when the
// release tail ends.

import { type SyncDiv, syncDivToHz } from '../core/fx';

export type LfoTarget = 'off' | 'pitch' | 'cutoff' | 'amp';
export type LfoSync   = 'free' | SyncDiv;
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface PolySynthParams {
  master: { tune: number; };                          // semitones global pitch offset
  osc1:  { wave: OscillatorType; level: number; octave: number; semi: number; detune: number; };
  osc2:  { wave: OscillatorType; level: number; octave: number; semi: number; detune: number; };
  sub:   { level: number; octave: number; };          // octave is -2 or -1
  noise: { level: number; color: number; };           // color 0=dark .. 1=bright
  filter: {
    type: FilterType;
    cutoff: number; resonance: number; envAmount: number;
    keyTrack: number;  // 0..1, how much cutoff follows note
    drive: number;     // 0..1, waveshaper pre-filter
    attack: number; decay: number; sustain: number; release: number;
  };
  amp: { attack: number; decay: number; sustain: number; release: number; };
  lfo1: { wave: OscillatorType; rate: number; depth: number; target: LfoTarget; sync?: LfoSync; };
  lfo2: { wave: OscillatorType; rate: number; depth: number; target: LfoTarget; sync?: LfoSync; };
}

export const POLY_DEFAULTS: PolySynthParams = {
  master: { tune: 0 },
  osc1:  { wave: 'sawtooth', level: 0.6, octave: 0, semi: 0, detune: 0 },
  osc2:  { wave: 'square',   level: 0.4, octave: 0, semi: 0, detune: 7 },
  sub:   { level: 0.3, octave: -1 },
  noise: { level: 0, color: 0.6 },
  filter: {
    type: 'lowpass',
    cutoff: 0.55, resonance: 0.25, envAmount: 0.45,
    keyTrack: 0, drive: 0,
    attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.35,
  },
  amp:  { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
  lfo1: { wave: 'sine', rate: 4,   depth: 0, target: 'off', sync: 'free' },
  lfo2: { wave: 'sine', rate: 0.5, depth: 0, target: 'off', sync: 'free' },
};

/**
 * Per-voice AudioParam handles exposed to the modulation host. Subtractive's
 * modular ADSR / LFO connections write into these alongside PolySynth's own
 * hardcoded envelope ramps (Web Audio sums contributions per AudioParam).
 */
export interface PolyVoiceParams {
  amp: AudioParam;     // amp envelope gain
  cutoff: AudioParam;  // filter frequency
  pitch: AudioParam;   // osc1 detune (cents)
}

export class PolySynth {
  params: PolySynthParams;
  bpm = 130;  // updated externally; used when an LFO has a sync division set
  private noiseBuffer: AudioBuffer;

  constructor(private ctx: AudioContext, private destination: AudioNode) {
    this.params = JSON.parse(JSON.stringify(POLY_DEFAULTS)) as PolySynthParams;
    this.noiseBuffer = makeWhiteNoise(ctx, 2);
  }

  /**
   * Trigger a voice and invoke `onVoice` with the freshly-allocated per-voice
   * AudioParams BEFORE any envelope ramps are scheduled — this lets the
   * modulation host bind external ADSR/LFO sources via Web Audio param summing.
   * Existing internal envelope scheduling still runs (Option B from Task 14).
   */
  triggerWithBinding(
    midi: number, time: number, gateDuration: number, accent = false,
    onVoice?: (params: PolyVoiceParams) => void,
  ) {
    this.internalTrigger(midi, time, gateDuration, accent, onVoice);
  }

  trigger(midi: number, time: number, gateDuration: number, accent = false) {
    this.internalTrigger(midi, time, gateDuration, accent);
  }

  private internalTrigger(
    midi: number, time: number, gateDuration: number, accent: boolean,
    onVoice?: (params: PolyVoiceParams) => void,
  ) {
    const ctx = this.ctx;
    const p = this.params;
    const noteFreq = 440 * Math.pow(2, (midi - 69 + p.master.tune) / 12);
    const velMul = accent ? 1.3 : 1.0;

    // ── Oscillators ──────────────────────────────────────────────────────
    const osc1 = ctx.createOscillator();
    osc1.type = p.osc1.wave;
    osc1.frequency.value = noteFreq * Math.pow(2, p.osc1.octave + p.osc1.semi / 12);
    osc1.detune.value = p.osc1.detune;
    const g1 = ctx.createGain(); g1.gain.value = p.osc1.level;
    osc1.connect(g1);

    const osc2 = ctx.createOscillator();
    osc2.type = p.osc2.wave;
    osc2.frequency.value = noteFreq * Math.pow(2, p.osc2.octave + p.osc2.semi / 12);
    osc2.detune.value = p.osc2.detune;
    const g2 = ctx.createGain(); g2.gain.value = p.osc2.level;
    osc2.connect(g2);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = noteFreq * Math.pow(2, p.sub.octave);
    const gs = ctx.createGain(); gs.gain.value = p.sub.level;
    sub.connect(gs);

    // ── Noise (gated when level=0) ───────────────────────────────────────
    let noise: AudioBufferSourceNode | null = null;
    let gn: GainNode | null = null;
    if (p.noise.level > 0) {
      noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'lowpass';
      nFilter.frequency.value = 200 + p.noise.color * 14800;
      gn = ctx.createGain(); gn.gain.value = p.noise.level;
      noise.connect(nFilter).connect(gn);
    }

    // ── Mix ──────────────────────────────────────────────────────────────
    const mix = ctx.createGain();
    g1.connect(mix); g2.connect(mix); gs.connect(mix);
    if (gn) gn.connect(mix);

    // ── Drive (waveshaper pre-filter) ────────────────────────────────────
    let driveOut: AudioNode = mix;
    if (p.filter.drive > 0) {
      const shaper = ctx.createWaveShaper();
      (shaper as { curve: Float32Array | null }).curve = makeDriveCurve(p.filter.drive);
      shaper.oversample = '2x';
      mix.connect(shaper);
      driveOut = shaper;
    }

    // ── Filter ───────────────────────────────────────────────────────────
    const filter = ctx.createBiquadFilter();
    filter.type = p.filter.type;
    filter.Q.value = 0.5 + p.filter.resonance * 22;
    driveOut.connect(filter);

    // Filter envelope with key tracking. KT shifts the base cutoff by note.
    const baseHz = 60 * Math.pow(220, p.filter.cutoff);  // 60..13200
    const ktCents = p.filter.keyTrack * (midi - 60) * 100;
    const baseCutoff = clamp(baseHz * Math.pow(2, ktCents / 1200), 40, 18000);
    const peakCutoff = clamp(baseCutoff * Math.pow(8, p.filter.envAmount * velMul), 40, 18000);
    const sustainCutoff = clamp(baseCutoff + (peakCutoff - baseCutoff) * p.filter.sustain, 40, 18000);
    const fa = Math.max(0.001, p.filter.attack);
    const fd = Math.max(0.001, p.filter.decay);
    const fr = Math.max(0.001, p.filter.release);

    // ── Amp gain node (envelope scheduled below) ─────────────────────────
    const amp = ctx.createGain();
    amp.gain.value = 0;

    // Modulation host bind point: expose per-voice AudioParams BEFORE the
    // hardcoded envelope ramps are scheduled. External ADSR/LFO outputs sum
    // into these params via Web Audio's per-AudioParam summing.
    if (onVoice) onVoice({ amp: amp.gain, cutoff: filter.frequency, pitch: osc1.detune });

    filter.frequency.setValueAtTime(baseCutoff, time);
    filter.frequency.linearRampToValueAtTime(peakCutoff, time + fa);
    filter.frequency.exponentialRampToValueAtTime(Math.max(sustainCutoff, 40), time + fa + fd);

    // ── Amp envelope ─────────────────────────────────────────────────────
    const peakAmp = 0.4 * velMul;
    const sustainAmp = Math.max(0.0001, peakAmp * p.amp.sustain);
    const aa = Math.max(0.001, p.amp.attack);
    const ad = Math.max(0.001, p.amp.decay);
    const ar = Math.max(0.005, p.amp.release);

    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peakAmp, time + aa);
    amp.gain.linearRampToValueAtTime(sustainAmp, time + aa + ad);

    // Tremolo gain (LFO->amp target writes here; defaults to 1.0 passthrough)
    const tremolo = ctx.createGain();
    tremolo.gain.value = 1;
    filter.connect(amp).connect(tremolo).connect(this.destination);

    const releaseStart = Math.max(time + aa + ad, time + gateDuration);
    amp.gain.setValueAtTime(sustainAmp, releaseStart);
    amp.gain.exponentialRampToValueAtTime(0.001, releaseStart + ar);
    filter.frequency.setValueAtTime(sustainCutoff, releaseStart);
    filter.frequency.exponentialRampToValueAtTime(Math.max(baseCutoff, 40), releaseStart + fr);

    const stopTime = releaseStart + Math.max(ar, fr) + 0.05;

    // ── LFOs (per-voice, routed to chosen target) ────────────────────────
    const lfoNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
    const setupLfo = (lp: PolySynthParams['lfo1']) => {
      if (lp.target === 'off' || lp.depth === 0) return;
      const lfo = ctx.createOscillator();
      lfo.type = lp.wave;
      // BPM-synced rate overrides the manual Hz when sync is set to anything but 'free'.
      const syncHz = (lp.sync && lp.sync !== 'free') ? syncDivToHz(this.bpm, lp.sync) : 0;
      lfo.frequency.value = syncHz > 0 ? syncHz : lp.rate;
      const lfoGain = ctx.createGain();
      lfo.connect(lfoGain);
      switch (lp.target) {
        case 'pitch':
          // Modulate osc1/osc2 detune (cents) — sub is fixed pitch
          lfoGain.gain.value = lp.depth * 1200;  // up to 1 octave
          lfoGain.connect(osc1.detune);
          lfoGain.connect(osc2.detune);
          break;
        case 'cutoff':
          lfoGain.gain.value = lp.depth * 6000;  // Hz
          lfoGain.connect(filter.frequency);
          break;
        case 'amp':
          // Tremolo: oscillates tremolo.gain between (1-depth)..(1+depth)
          lfoGain.gain.value = lp.depth;
          lfoGain.connect(tremolo.gain);
          break;
      }
      lfo.start(time);
      lfo.stop(stopTime);
      lfoNodes.push({ osc: lfo, gain: lfoGain });
    };
    setupLfo(p.lfo1);
    setupLfo(p.lfo2);

    osc1.start(time); osc2.start(time); sub.start(time);
    osc1.stop(stopTime); osc2.stop(stopTime); sub.stop(stopTime);
    if (noise) { noise.start(time); noise.stop(stopTime); }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function makeDriveCurve(amount: number): Float32Array {
  const n = 4096;
  const curve = new Float32Array(n);
  const k = 1 + amount * amount * 25;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);  // normalize peak to ±1
  }
  return curve;
}

function makeWhiteNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
