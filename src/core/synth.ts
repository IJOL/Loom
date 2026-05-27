export type Wave = 'sawtooth' | 'square';

export interface VoiceParams {
  cutoff: number;     // 0..1, mapped exp to ~80..8000 Hz
  resonance: number;  // 0..1, mapped to filter Q
  envMod: number;     // 0..1, how much the env opens the filter
  decay: number;      // 0..1, filter env decay time
  accent: number;     // 0..1, intensity of accented notes
  wave: Wave;
}

export interface Note {
  freq: number;
  accent: boolean;
  slide: boolean;     // true when this note continues from a sliding previous note
  duration: number;   // seconds the gate is open
}

// Single-voice, monophonic TB-303-style synth: saw/square → resonant LP → VCA.
// One persistent OscillatorNode + BiquadFilter that we keep reusing; each
// `trigger()` schedules a fresh envelope at sample-accurate `time`.
export class TB303 {
  private osc: OscillatorNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;

  params: VoiceParams = {
    cutoff: 0.28,
    resonance: 0.78,
    envMod: 0.65,
    decay: 0.45,
    accent: 0.6,
    wave: 'sawtooth',
  };

  constructor(private ctx: AudioContext, destination: AudioNode) {
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 110;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 100;

    this.amp = ctx.createGain();
    this.amp.gain.value = 0;

    this.osc.connect(this.filter);
    this.filter.connect(this.amp);
    this.amp.connect(destination);
    this.osc.start();
  }

  /** Filter cutoff AudioParam — exposed so the modulation host can sum into it. */
  get cutoffParam(): AudioParam { return this.filter.frequency; }
  /** Filter resonance AudioParam — exposed for modulation. */
  get resonanceParam(): AudioParam { return this.filter.Q; }
  /** Amp gain AudioParam — exposed for modulation (note: also written by trigger envelope). */
  get ampParam(): AudioParam { return this.amp.gain; }

  trigger(note: Note, time: number) {
    const p = this.params;
    const baseCutoff = 80 * Math.pow(100, p.cutoff);
    const envAmount = p.envMod * 6000;
    const decaySec = 0.05 + p.decay * 1.2;
    const accentBoost = note.accent ? p.accent : 0;
    const peakCutoff = Math.min(baseCutoff + envAmount * (1 + accentBoost), 18000);
    const peakAmp = note.accent ? 0.35 + p.accent * 0.4 : 0.3;

    this.osc.type = p.wave;

    // Pitch: slide ramps from current freq, otherwise jump.
    this.osc.frequency.cancelScheduledValues(time);
    if (note.slide) {
      const current = Math.max(this.osc.frequency.value, 20);
      this.osc.frequency.setValueAtTime(current, time);
      this.osc.frequency.exponentialRampToValueAtTime(note.freq, time + 0.06);
    } else {
      this.osc.frequency.setValueAtTime(note.freq, time);
    }

    // Filter Q (accent adds extra bite).
    this.filter.Q.cancelScheduledValues(time);
    this.filter.Q.setValueAtTime(1 + p.resonance * 25 + accentBoost * 6, time);

    // Amp envelope: re-attack unless the previous note slid into this one.
    this.amp.gain.cancelScheduledValues(time);
    if (note.slide) {
      this.amp.gain.setValueAtTime(peakAmp, time);
    } else {
      this.amp.gain.setValueAtTime(0, time);
      this.amp.gain.linearRampToValueAtTime(peakAmp, time + 0.003);
    }
    this.amp.gain.setValueAtTime(peakAmp, time + note.duration - 0.02);
    this.amp.gain.exponentialRampToValueAtTime(0.001, time + note.duration);

    // Filter envelope: open immediately, decay to base.
    this.filter.frequency.cancelScheduledValues(time);
    this.filter.frequency.setValueAtTime(peakCutoff, time);
    this.filter.frequency.exponentialRampToValueAtTime(
      Math.max(baseCutoff, 40),
      time + decaySec * (note.accent ? 0.6 : 1),
    );
  }
}
