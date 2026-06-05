// Polyphonic subtractive synth — 2 oscillators + sub + noise → drive →
// multimode filter (with ADSR + key tracking) → amp (with ADSR) → output.
// Modulation (LFOs, extra envelopes) is supplied externally by the
// SubtractiveEngine's ModulationHost and summed into the per-voice
// AudioParams exposed via `triggerWithBinding`.
//
// Each `trigger()` allocates a fresh per-note voice subgraph that schedules
// the entire envelope at sample-accurate times and frees itself when the
// release tail ends.

import { velGain } from '../core/velocity-gain';

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
};

/**
 * Per-voice AudioParam handles exposed to the modulation host. Subtractive's
 * modular ADSR / LFO connections write into these alongside PolySynth's own
 * hardcoded envelope ramps (Web Audio sums contributions per AudioParam).
 */
export interface PolyVoiceParams {
  amp: AudioParam;       // amp envelope gain
  cutoff: AudioParam;    // filter frequency
  resonance: AudioParam; // filter Q
  pitch: AudioParam;     // osc1 detune (cents)
  pitch2: AudioParam;    // osc2 detune (cents)
  osc1Level: AudioParam; // osc1 gain
  osc2Level: AudioParam; // osc2 gain
  subLevel:  AudioParam; // sub gain
  noiseLevel: AudioParam; // noise gain (persistent — sounds whenever level>0)
  noiseColor: AudioParam; // noise lowpass cutoff (Hz)
  envAmount:  AudioParam; // filter env contribution gain (Hz of sweep)
  drive:      AudioParam; // waveshaper input boost (pre-saturation gain)
  keyTrack:   AudioParam; // filter key-tracking gain (Hz contribution per voice)
  tune:       AudioParam; // master tune detune offset (cents) applied to all oscs
  /**
   * Cuts this voice's amp gate at `time` by cancelling the internal amp
   * envelope's scheduled curve and ramping it to zero. Used by Voice.release
   * to support live note-off, since trigger() pre-schedules the full envelope.
   */
  releaseGate: (time: number) => void;
}

export class PolySynth {
  params: PolySynthParams;
  bpm = 130;  // updated externally; retained for downstream consumers (e.g. sync-aware modulators)
  /** Modulation bus — one ConstantSourceNode per shared-modulatable
   *  AudioParam. .offset is the AudioParam external SHARED modulators write
   *  to; the bus output is connected to each allocated voice's matching
   *  AudioParam in internalTrigger, so the modulation fans out to every
   *  playing voice via Web Audio summing. */
  readonly modBus: Record<string, ConstantSourceNode>;
  maxVoices = 8;
  mode: 'mono' | 'poly' = 'poly';
  retrig = true;  // mono-only; true = restart envelope per note, false = legato
  /** Built-in envelope bypass switches. When false, internalTrigger skips
   *  scheduling that hardcoded envelope, leaving its ConstantSource at 0 so an
   *  external modular ADSR (if any) drives the destination AudioParam alone.
   *  Toggled by SubtractiveEngine via the amp.builtinEnv / filter.builtinEnv
   *  discrete params. */
  ampEnvEnabled = true;
  filterEnvEnabled = true;
  private monoSavedMax = 8;
  private monoVoice: { osc1: OscillatorNode; osc2: OscillatorNode; sub: OscillatorNode } | null = null;
  private active: Array<{ midi: number; allocatedAt: number; stop: (time: number) => void }> = [];
  private noiseBuffer: AudioBuffer;

  setMaxVoices(n: number): void {
    this.maxVoices = Math.max(1, Math.min(16, Math.floor(n)));
  }

  setMode(m: 'mono' | 'poly'): void {
    if (m === 'mono' && this.mode !== 'mono') {
      this.monoSavedMax = this.maxVoices;
      this.maxVoices = 1;
    } else if (m === 'poly' && this.mode === 'mono') {
      this.maxVoices = this.monoSavedMax;
    }
    this.mode = m;
  }

  setRetrig(v: boolean): void { this.retrig = v; }

  activeVoiceCount(): number {
    return this.active.length;
  }

  constructor(private ctx: AudioContext, private destination: AudioNode) {
    this.params = JSON.parse(JSON.stringify(POLY_DEFAULTS)) as PolySynthParams;
    this.noiseBuffer = makeWhiteNoise(ctx, 2);
    const mkBus = (): ConstantSourceNode => {
      const n = ctx.createConstantSource();
      n.offset.value = 0;
      n.start();
      return n;
    };
    this.modBus = {
      'filter.cutoff':    mkBus(),
      'filter.resonance': mkBus(),
      'amp.gain':         mkBus(),
    };
  }

  /**
   * Trigger a voice and invoke `onVoice` with the freshly-allocated per-voice
   * AudioParams BEFORE any envelope ramps are scheduled — this lets the
   * modulation host bind external ADSR/LFO sources via Web Audio param summing.
   * Existing internal envelope scheduling still runs (Option B from Task 14).
   */
  triggerWithBinding(
    midi: number, time: number, gateDuration: number, accent = false,
    onVoice?: (params: PolyVoiceParams) => void, velocity?: number,
  ) {
    this.internalTrigger(midi, time, gateDuration, accent, onVoice, velocity);
  }

  trigger(midi: number, time: number, gateDuration: number, accent = false, velocity?: number) {
    this.internalTrigger(midi, time, gateDuration, accent, undefined, velocity);
  }

  private internalTrigger(
    midi: number, time: number, gateDuration: number, accent: boolean,
    onVoice?: (params: PolyVoiceParams) => void, velocity?: number,
  ) {
    const ctx = this.ctx;
    const p = this.params;
    // Voice stealing: if we're at the cap, stop the oldest active voice
    // immediately so the new note can take its slot. shift() removes the
    // oldest entry from `this.active` synchronously; oldest.stop(time) starts
    // a release ramp so the stolen voice fades out without a click.
    // Skip when mono+legato — the legato fast-path below reuses the voice.
    const legatoSkipsSteal = this.mode === 'mono' && !this.retrig && this.monoVoice;
    if (!legatoSkipsSteal) {
      // Same-note stealing first: a retrigger of the same pitch should
      // replace the previous instance instead of accumulating. Without this,
      // imported MIDI tracks that don't emit explicit note-off between
      // close retriggers stack voices and pile amplitude / CPU.
      for (let i = this.active.length - 1; i >= 0; i--) {
        if (this.active[i].midi === midi) {
          this.active[i].stop(time);
          this.active.splice(i, 1);
        }
      }
      while (this.active.length >= this.maxVoices) {
        const oldest = this.active.shift();
        if (oldest) oldest.stop(time);
      }
    }
    // Mono + legato: re-pitch the existing voice's oscillators in place;
    // do not stop the voice or restart its envelope.
    if (this.mode === 'mono' && !this.retrig && this.monoVoice) {
      const noteFreq = 440 * Math.pow(2, (midi - 69) / 12);
      this.monoVoice.osc1.frequency.setValueAtTime(
        noteFreq * Math.pow(2, p.osc1.octave + p.osc1.semi / 12), time);
      this.monoVoice.osc2.frequency.setValueAtTime(
        noteFreq * Math.pow(2, p.osc2.octave + p.osc2.semi / 12), time);
      this.monoVoice.sub.frequency.setValueAtTime(
        noteFreq * Math.pow(2, p.sub.octave), time);
      return;
    }
    // Base note frequency excludes master.tune — that's applied as a
    // modulatable detune offset (cents) on each oscillator below, so
    // realtime LFO/ADSR on master.tune actually bends pitch.
    const noteFreq = 440 * Math.pow(2, (midi - 69) / 12);
    const accentMul = accent ? 1.3 : 1.0;       // filter-env brightness (timbre)
    const ampGain = velGain(velocity, accent); // loudness

    // master.tune in semitones → cents detune offset shared across oscs.
    // Each osc.detune AudioParam receives `tune.offset` (cents) via a per-voice
    // ConstantSourceNode, so modulating `tune` sweeps pitch on every osc.
    const tune = ctx.createConstantSource();
    tune.offset.value = p.master.tune * 100;
    tune.start();

    // ── Oscillators ──────────────────────────────────────────────────────
    const osc1 = ctx.createOscillator();
    osc1.type = p.osc1.wave;
    osc1.frequency.value = noteFreq * Math.pow(2, p.osc1.octave + p.osc1.semi / 12);
    osc1.detune.value = p.osc1.detune;
    tune.connect(osc1.detune);
    const g1 = ctx.createGain(); g1.gain.value = p.osc1.level;
    osc1.connect(g1);

    const osc2 = ctx.createOscillator();
    osc2.type = p.osc2.wave;
    osc2.frequency.value = noteFreq * Math.pow(2, p.osc2.octave + p.osc2.semi / 12);
    osc2.detune.value = p.osc2.detune;
    tune.connect(osc2.detune);
    const g2 = ctx.createGain(); g2.gain.value = p.osc2.level;
    osc2.connect(g2);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = noteFreq * Math.pow(2, p.sub.octave);
    tune.connect(sub.detune);
    const gs = ctx.createGain(); gs.gain.value = p.sub.level;
    sub.connect(gs);

    if (this.mode === 'mono') {
      this.monoVoice = { osc1, osc2, sub };
    }

    // ── Noise (always-on, gated via gn.gain so noise.level is modulatable) ─
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'lowpass';
    nFilter.frequency.value = 200 + p.noise.color * 14800;
    const gn = ctx.createGain();
    gn.gain.value = p.noise.level;
    noise.connect(nFilter).connect(gn);

    // ── Mix ──────────────────────────────────────────────────────────────
    const mix = ctx.createGain();
    g1.connect(mix); g2.connect(mix); gs.connect(mix); gn.connect(mix);

    // ── Drive (parallel dry/wet — `drive.gain` modulates wet level) ──────
    // Dry path always-on; wet path sums a saturated copy proportional to
    // `drivePre.gain` (which becomes the modulatable `drive` AudioParam).
    // At drive=0 wet contributes nothing, so the signal stays clean. At
    // drive=1 the wet path is fully saturated. Modulating drivePre swings
    // distortion in real time.
    const drivePre = ctx.createGain();
    drivePre.gain.value = p.filter.drive;
    const shaper = ctx.createWaveShaper();
    (shaper as { curve: Float32Array | null }).curve = makeDriveCurve(1.0);
    shaper.oversample = '2x';
    // Dry: mix → filter. Wet: mix → shaper → drivePre → filter.
    mix.connect(shaper);
    shaper.connect(drivePre);

    // ── Filter ───────────────────────────────────────────────────────────
    const filter = ctx.createBiquadFilter();
    filter.type = p.filter.type;
    filter.Q.value = 0.5 + p.filter.resonance * 22;
    // Wire the shared modulation bus → this voice's filter/amp AudioParams.
    // External shared LFOs write to modBus['filter.cutoff'].offset and the
    // contribution fans out here via Web Audio summing.
    this.modBus['filter.cutoff'].connect(filter.frequency);
    this.modBus['filter.resonance'].connect(filter.Q);
    mix.connect(filter);
    drivePre.connect(filter);

    // ── Cutoff path: split into BASE + KEY TRACK + ENVELOPE ─────────────
    // baseCutoff (Hz, the steady-state filter freq absent envelope) sums
    // with the envelope contribution into filter.frequency. KeyTrack lives
    // as a Gain whose `.gain` is the modulatable AudioParam; the constant
    // factor (semitone delta × 100 / 1200) is folded into a ConstantSource.
    const baseHz = 60 * Math.pow(220, p.filter.cutoff);  // 60..13200
    const baseCutoffSrc = ctx.createConstantSource();
    baseCutoffSrc.offset.value = Math.min(baseHz, 18000);
    baseCutoffSrc.start();
    baseCutoffSrc.connect(filter.frequency);
    filter.frequency.value = 0;

    // KeyTrack: keyTrack × keySemiDelta × 100 cents of contribution. Linearise
    // to Hz: contribution ≈ keyTrack × keySemiDelta × baseHz × (2^(1/12) - 1).
    // Modulating `keyTrack.gain` sweeps how much the note's pitch pulls the
    // filter cutoff up/down.
    const keySemiDelta = midi - 60;
    const keyTrackSrc = ctx.createConstantSource();
    keyTrackSrc.offset.value = keySemiDelta * baseHz * (Math.pow(2, 1 / 12) - 1);
    keyTrackSrc.start();
    const keyTrack = ctx.createGain();
    keyTrack.gain.value = p.filter.keyTrack;
    keyTrackSrc.connect(keyTrack).connect(filter.frequency);

    // EnvAmount: split env scheduling into a normalised 0..1 ConstantSource
    // (`envCutoffNorm`) multiplied by a Gain (`envScaler`) whose .gain is the
    // modulatable AudioParam. envScaler.gain = baseHz × 7 × envAmount gives
    // a peak ≈ baseHz × 8 at envAmount=1 (matches the legacy multiplier shape
    // linearly rather than exponentially — close enough for sweeping).
    const fa = Math.max(0.001, p.filter.attack);
    const fd = Math.max(0.001, p.filter.decay);
    const fr = Math.max(0.001, p.filter.release);

    const envCutoffNorm = ctx.createConstantSource();
    envCutoffNorm.offset.value = 0;
    envCutoffNorm.start();
    const envScaler = ctx.createGain();
    // Cap the envelope sweep so a maxed-out cutoff knob doesn't push the
    // filter freq into self-oscillation territory beyond Nyquist.
    const envRange = Math.min(baseHz * 7, 16000);
    envScaler.gain.value = envRange * p.filter.envAmount * accentMul;
    envCutoffNorm.connect(envScaler).connect(filter.frequency);

    // ── Amp gain node (envelope scheduled below) ─────────────────────────
    const amp = ctx.createGain();
    amp.gain.value = 0;
    this.modBus['amp.gain'].connect(amp.gain);

    // ── Internal envelope nodes ──────────────────────────────────────────
    // Per-voice amp envelope routes through a ConstantSourceNode so the
    // destination AudioParam (amp.gain) never receives cancelScheduledValues
    // / setValueAtTime — external modulators sum cleanly.
    const envAmp = ctx.createConstantSource();
    envAmp.offset.value = 0;
    envAmp.start();
    envAmp.connect(amp.gain);

    // Per-voice gate cutter for Voice.release(). envAmp is the
    // ConstantSourceNode driving amp.gain; cancelling and ramping its offset
    // is what actually silences the voice (amp.gain.value stays 0).
    // 5 ms linear ramp to silence avoids audible clicks. Mirrors TB303.releaseGate.
    const releaseGate = (releaseTime: number) => {
      envAmp.offset.cancelScheduledValues(releaseTime);
      envAmp.offset.setValueAtTime(envAmp.offset.value, releaseTime);
      envAmp.offset.linearRampToValueAtTime(0, releaseTime + 0.005);
    };

    // Register this voice with the central allocator for voice-stealing.
    // Removed synchronously by the stealing loop above (shift()) when a new
    // trigger steals this slot, or by osc1.onended below when the natural
    // release tail finishes.
    const entry = {
      midi,
      allocatedAt: time,
      stop: (t: number) => releaseGate(t),
    };
    this.active.push(entry);

    // Modulation host bind point: expose per-voice AudioParams BEFORE the
    // hardcoded envelope ramps are scheduled. External ADSR/LFO outputs sum
    // into these params via Web Audio's per-AudioParam summing.
    if (onVoice) onVoice({
      amp: amp.gain,
      cutoff: filter.frequency,
      resonance: filter.Q,
      pitch: osc1.detune,
      pitch2: osc2.detune,
      osc1Level: g1.gain,
      osc2Level: g2.gain,
      subLevel:  gs.gain,
      noiseLevel: gn.gain,
      noiseColor: nFilter.frequency,
      envAmount:  envScaler.gain,
      drive:      drivePre.gain,
      keyTrack:   keyTrack.gain,
      tune:       tune.offset,
      releaseGate,
    });

    // Schedule the normalised envCutoff (0..1) — sustain knob clamps it.
    // Skipped when the built-in filter env is bypassed; envCutoffNorm then
    // stays at 0 so the filter sits at its base cutoff (+ any modular ADSR).
    if (this.filterEnvEnabled) {
      envCutoffNorm.offset.setValueAtTime(0, time);
      envCutoffNorm.offset.linearRampToValueAtTime(1, time + fa);
      envCutoffNorm.offset.linearRampToValueAtTime(Math.max(p.filter.sustain, 0), time + fa + fd);
    }

    // ── Amp envelope ─────────────────────────────────────────────────────
    const peakAmp = 0.4 * ampGain;
    const sustainAmp = Math.max(0.0001, peakAmp * p.amp.sustain);
    const aa = Math.max(0.001, p.amp.attack);
    const ad = Math.max(0.001, p.amp.decay);
    const ar = Math.max(0.005, p.amp.release);

    envAmp.offset.setValueAtTime(0, time);
    // Skipped when the built-in amp env is bypassed; envAmp stays at 0 so the
    // voice is silent unless an external modular ADSR drives amp.gain.
    if (this.ampEnvEnabled) {
      envAmp.offset.linearRampToValueAtTime(peakAmp, time + aa);
      envAmp.offset.linearRampToValueAtTime(sustainAmp, time + aa + ad);
    }

    filter.connect(amp).connect(this.destination);

    const releaseStart = Math.max(time + aa + ad, time + gateDuration);
    if (this.ampEnvEnabled) {
      envAmp.offset.setValueAtTime(sustainAmp, releaseStart);
      envAmp.offset.exponentialRampToValueAtTime(0.001, releaseStart + ar);
    }
    // Release the normalised cutoff envelope back to 0.
    if (this.filterEnvEnabled) {
      envCutoffNorm.offset.setValueAtTime(Math.max(p.filter.sustain, 0), releaseStart);
      envCutoffNorm.offset.linearRampToValueAtTime(0, releaseStart + fr);
    }

    const stopTime = releaseStart + Math.max(ar, fr) + 0.05;

    osc1.start(time); osc2.start(time); sub.start(time);
    noise.start(time);
    osc1.stop(stopTime); osc2.stop(stopTime); sub.stop(stopTime); noise.stop(stopTime);
    envAmp.stop(stopTime); envCutoffNorm.stop(stopTime);
    tune.stop(stopTime); baseCutoffSrc.stop(stopTime); keyTrackSrc.stop(stopTime);

    // When the voice's natural lifetime ends, drop it from the active list so
    // the slot is available for new notes. If this voice was already stolen
    // (shift()ed out of `active`), indexOf returns -1 and the splice is a no-op.
    osc1.onended = () => {
      const idx = this.active.indexOf(entry);
      if (idx >= 0) this.active.splice(idx, 1);
      if (this.monoVoice && this.monoVoice.osc1 === osc1) {
        this.monoVoice = null;
      }
    };
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
