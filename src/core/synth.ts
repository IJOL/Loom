import { velToGain, resolveVelocity } from './velocity-gain';

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
  velocity?: number;
}

// Single-voice, monophonic TB-303-style synth: saw/square → resonant LP → VCA.
// One persistent OscillatorNode + BiquadFilter that we keep reusing; each
// `trigger()` schedules a fresh envelope at sample-accurate `time`.
export class TB303 {
  private osc: OscillatorNode;
  public readonly filter: BiquadFilterNode;
  public readonly amp: GainNode;

  private envCutoff!: ConstantSourceNode;
  private envRes!: ConstantSourceNode;
  private envAmp!: ConstantSourceNode;

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

    // Internal envelope sources: scheduling happens on these nodes' .offset, and
    // they sum into the destination AudioParams. The destination filter.frequency
    // / filter.Q / amp.gain are NEVER scheduled directly — that would clobber
    // summed contributions from external modulators (LFOs, ADSRs).
    this.envCutoff = ctx.createConstantSource();
    this.envCutoff.offset.value = 0;
    this.envCutoff.start();
    this.envCutoff.connect(this.filter.frequency);

    this.envRes = ctx.createConstantSource();
    this.envRes.offset.value = 0;
    this.envRes.start();
    this.envRes.connect(this.filter.Q);

    this.envAmp = ctx.createConstantSource();
    this.envAmp.offset.value = 0;
    this.envAmp.start();
    this.envAmp.connect(this.amp.gain);

    // Base values stay at 0 on the destination params — the env nodes contribute
    // the actual values via summing. External modulators also sum here.
    this.filter.frequency.value = 0;
    this.filter.Q.value = 0;
    this.amp.gain.value = 0;
  }

  trigger(note: Note, time: number) {
    const p = this.params;
    const baseCutoff = 80 * Math.pow(100, p.cutoff);
    const envAmount = p.envMod * 6000;
    const decaySec = 0.05 + p.decay * 1.2;
    const accentBoost = note.accent ? p.accent : 0;
    const peakCutoff = Math.min(baseCutoff + envAmount * (1 + accentBoost), 18000);
    const peakAmp = 0.3 * velToGain(resolveVelocity(note.velocity, note.accent));

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
    this.envRes.offset.cancelScheduledValues(time);
    this.envRes.offset.setValueAtTime(1 + p.resonance * 25 + accentBoost * 6, time);

    // Amp envelope: re-attack unless the previous note slid into this one.
    this.envAmp.offset.cancelScheduledValues(time);
    const attackEnd = note.slide ? time : time + 0.003;
    if (note.slide) {
      this.envAmp.offset.setValueAtTime(peakAmp, time);
    } else {
      this.envAmp.offset.setValueAtTime(0, time);
      this.envAmp.offset.linearRampToValueAtTime(peakAmp, attackEnd);
    }
    // Hold peak until shortly before gate end, then ramp to silence. For very
    // short notes the 20ms tail margin would land before the attack endpoint,
    // producing out-of-order events (and a negative time when duration < 20ms),
    // so we clamp the release anchor to never precede the attack ramp.
    const releaseStart = Math.max(attackEnd, time + note.duration - 0.02);
    this.envAmp.offset.setValueAtTime(peakAmp, releaseStart);
    this.envAmp.offset.exponentialRampToValueAtTime(0.001, Math.max(releaseStart + 0.001, time + note.duration));

    // Filter envelope: open immediately, decay to base.
    this.envCutoff.offset.cancelScheduledValues(time);
    this.envCutoff.offset.setValueAtTime(peakCutoff, time);
    this.envCutoff.offset.exponentialRampToValueAtTime(
      Math.max(baseCutoff, 40),
      time + decaySec * (note.accent ? 0.6 : 1),
    );
  }

  /**
   * Cut the amp gate at `time`. Cancels pending amp envelope automation and
   * ramps to silence quickly. Used by Voice.release() to support live note-off
   * since `trigger()` pre-schedules the full envelope up front.
   */
  releaseGate(time: number): void {
    this.envAmp.offset.cancelScheduledValues(time);
    // Read the current value approximately — envAmp is a ConstantSourceNode
    // whose offset is itself an AudioParam; we can't read its instantaneous
    // value mid-ramp without an analyser, so we set a known floor and ramp
    // from there. A 5 ms linear ramp avoids audible clicks.
    this.envAmp.offset.setValueAtTime(this.envAmp.offset.value, time);
    this.envAmp.offset.linearRampToValueAtTime(0, time + 0.005);
  }
}
