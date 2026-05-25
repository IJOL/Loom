import type { TB303 } from './synth';
import type { DrumMachine } from './drums';
import { DRUM_LANES } from './drums';
import type { PolySynth } from './polysynth';
import type { EngineSequencer } from './engines/engine-types';
import { emptyPattern, AUTOMATION_SUB_RES, type PatternData } from './pattern';
import { TICKS_PER_STEP } from './notes';

export interface BassStep {
  on: boolean;
  note: number;     // MIDI
  accent: boolean;
  slide: boolean;   // glissando into NEXT step
}

export interface DrumStep {
  on: boolean;
  accent: boolean;
  roll?: number;  // 0/undefined = single hit, 2 = 32nds, 4 = 64ths
}

export interface PolyStep {
  on: boolean;
  notes: number[];  // MIDI notes — single note = monophonic, multiple = chord
  accent: boolean;
  tie: boolean;     // hold gate past next step
}

// Multi-track look-ahead scheduler (Chris Wilson "A Tale of Two Clocks").
// All tracks share the same length and clock. The current pattern's data
// (bass + drums + melody + length) lives in `pattern` so the bank can swap
// slots in-place without rebuilding the scheduler.
export class Sequencer {
  pattern: PatternData;
  bpm = 130;
  swing = 0;             // 0..0.6, applied to odd 16ths
  loopEnabled = true;    // when false, stops at end of pattern instead of wrapping
  onStep?: (idx: number) => void;
  onPatternChange?: () => void;
  onEnded?: () => void;  // fires once when a non-looping pattern reaches its end
  // Optional overrides for tonal tracks: let main.ts intercept (e.g. arpeggiator)
  // without changing the scheduler. When set, called instead of the default trigger.
  onMelodyTrigger?: (note: number, time: number, gate: number, accent: boolean) => void;
  onBassTrigger?:   (note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => void;
  // Fires per note in extra poly tracks. trackIdx is the position in extraPolyTracks.
  onExtraPolyTrigger?: (trackIdx: number, note: number, time: number, gate: number, accent: boolean) => void;

  /** Optional Session-mode tick hook. When set AND `sessionMode === true`,
   *  the regular classic-pattern scheduling is skipped and this is called
   *  instead with (currentTime, lookaheadSec). The host owns scheduling. */
  sessionTick?: (now: number, lookahead: number) => void;
  sessionMode: boolean = false;

  private playing = false;
  private nextStepTime = 0;
  private currentStep = 0;
  private timerId: number | null = null;
  private pendingPattern: PatternData | null = null;
  private engineSequencers: EngineSequencer[] = [];

  registerEngineSequencer(seq: EngineSequencer): void {
    this.engineSequencers.push(seq);
  }

  unregisterEngineSequencer(seq: EngineSequencer): void {
    const idx = this.engineSequencers.indexOf(seq);
    if (idx >= 0) this.engineSequencers.splice(idx, 1);
  }

  constructor(
    private ctx: AudioContext,
    private synth: TB303,
    private drumMachine: DrumMachine,
    private polysynth: PolySynth,
    length = 32,
  ) {
    this.pattern = emptyPattern(length);
  }

  get bass()   { return this.pattern.bass; }
  get drums()  { return this.pattern.drums; }
  get melody() { return this.pattern.melody; }
  get length() { return this.pattern.length; }

  isPlaying() { return this.playing; }

  start() {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.playing = true;
    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.tick();
  }

  stop() {
    this.playing = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  setLength(n: number) {
    const old = this.pattern.length;
    this.pattern.length = n;
    if (n > old) {
      const diff = n - old;
      for (let i = 0; i < diff; i++) {
        this.pattern.bass.push({ on: false, note: 36, accent: false, slide: false });
        this.pattern.melody.push({ on: false, notes: [60], accent: false, tie: false });
        for (const lane of DRUM_LANES) {
          this.pattern.drums[lane].push({ on: false, accent: false });
        }
      }
      for (const lane of this.pattern.automation) {
        const newLen = n * AUTOMATION_SUB_RES;
        const last = lane.values[lane.values.length - 1] ?? 0.5;
        while (lane.values.length < newLen) lane.values.push(last);
      }
    } else if (n < old) {
      this.pattern.bass.length = n;
      this.pattern.melody.length = n;
      for (const lane of DRUM_LANES) this.pattern.drums[lane].length = n;
      for (const lane of this.pattern.automation) lane.values.length = n * AUTOMATION_SUB_RES;
    }
    if (this.currentStep >= n) this.currentStep = 0;
    for (const es of this.engineSequencers) {
      es.setLength(n);
    }
  }

  // Returns the currently audible step as a fractional step index (e.g. 5.5 = mid step 5).
  // Used by the automation engine to interpolate continuously at audio rate.
  currentPlayPosition(): number {
    if (!this.playing) return 0;
    const stepDur = 60 / this.bpm / 4;
    const recentStep = (this.currentStep - 1 + this.pattern.length) % this.pattern.length;
    const recentStart = this.nextStepTime - stepDur;
    const elapsed = this.ctx.currentTime - recentStart;
    if (elapsed < 0) return recentStep;
    if (elapsed > stepDur) return (recentStep + 1) % this.pattern.length;
    return recentStep + elapsed / stepDur;
  }

  setPattern(p: PatternData) {
    this.pattern = p;
    this.pendingPattern = null;
    if (this.currentStep >= p.length) this.currentStep = 0;
  }

  // Schedules a pattern swap to happen at the *next* loop boundary
  // (start of the next cycle), so the change feels musical.
  queuePattern(p: PatternData) {
    if (!this.playing) { this.setPattern(p); return; }
    this.pendingPattern = p;
  }

  hasPendingPattern(): boolean { return this.pendingPattern !== null; }

  cancelPendingPattern() { this.pendingPattern = null; }

  private tick = () => {
    if (!this.playing) return;
    const lookahead = 0.12;

    if (this.sessionMode) {
      // Session mode: host owns scheduling via sessionTick hook.
      if (this.sessionTick) this.sessionTick(this.ctx.currentTime, lookahead);
    } else {
      // Classic mode: existing look-ahead pattern scheduling.
      while (this.playing && this.nextStepTime < this.ctx.currentTime + lookahead) {
        // At the start of a new loop cycle, apply any queued pattern swap.
        if (this.currentStep === 0 && this.pendingPattern) {
          this.pattern = this.pendingPattern;
          this.pendingPattern = null;
          const audioTime = this.nextStepTime;
          const delayMs = Math.max(0, (audioTime - this.ctx.currentTime) * 1000);
          const cb = this.onPatternChange;
          if (cb) window.setTimeout(() => cb(), delayMs);
        }
        const stepDur = 60 / this.bpm / 4;
        const swingShift = this.currentStep % 2 === 1 ? this.swing * stepDur : 0;
        this.scheduleStep(this.currentStep, this.nextStepTime + swingShift, stepDur);
        this.nextStepTime += stepDur;
        const next = this.currentStep + 1;
        if (next >= this.pattern.length) {
          if (this.loopEnabled) {
            this.currentStep = 0;
          } else {
            // One-shot finished: stop after the last step's audio time is reached.
            this.playing = false;
            const endTime = this.nextStepTime;
            const delayMs = Math.max(0, (endTime - this.ctx.currentTime) * 1000);
            if (this.onEnded) window.setTimeout(() => this.onEnded?.(), delayMs);
            break;
          }
        } else {
          this.currentStep = next;
        }
      }
    }

    if (this.playing) this.timerId = window.setTimeout(this.tick, 25);
  };

  private scheduleStep(idx: number, time: number, stepDur: number) {
    if (this.pattern.bassMode === 'piano') {
      const stepStartTickB = idx * TICKS_PER_STEP;
      const stepEndTickB   = stepStartTickB + TICKS_PER_STEP;
      const tickToSecB     = stepDur / TICKS_PER_STEP;
      for (const n of this.pattern.bassNotes) {
        if (n.start < stepStartTickB || n.start >= stepEndTickB) continue;
        // slidingIn: any other note overlaps the start of this one.
        const slidingIn = this.pattern.bassNotes.some((m) =>
          m !== n && m.start < n.start && (m.start + m.duration) > n.start + 1,
        );
        const offsetSec = (n.start - stepStartTickB) * tickToSecB;
        const durSec = Math.max(0.01, n.duration * tickToSecB);
        const accent = n.velocity >= 100;
        if (this.onBassTrigger) {
          this.onBassTrigger(n.midi, time + offsetSec, durSec, accent, slidingIn);
        } else {
          this.synth.trigger({
            freq: midiToFreq(n.midi),
            accent,
            slide: slidingIn,
            duration: durSec,
          }, time + offsetSec);
        }
      }
    } else {
      const bass = this.pattern.bass[idx];
      const prev = this.pattern.bass[(idx - 1 + this.pattern.length) % this.pattern.length];
      if (bass.on) {
        const slidingIn = prev.on && prev.slide;
        const duration = bass.slide ? stepDur * 1.5 : stepDur * 0.92;
        if (this.onBassTrigger) {
          this.onBassTrigger(bass.note, time, duration, bass.accent, slidingIn);
        } else {
          this.synth.trigger({
            freq: midiToFreq(bass.note),
            accent: bass.accent,
            slide: slidingIn,
            duration,
          }, time);
        }
      }
    }

    for (const lane of DRUM_LANES) {
      const step = this.pattern.drums[lane][idx];
      if (!step.on) continue;
      const div = step.roll && step.roll > 1 ? step.roll : 1;
      if (div === 1) {
        this.drumMachine.trigger(lane, time, step.accent);
      } else {
        const subDur = stepDur / div;
        for (let r = 0; r < div; r++) {
          this.drumMachine.trigger(lane, time + r * subDur, step.accent);
        }
      }
    }

    // Always-on extra poly tracks (piano-roll notes), regardless of main poly mode.
    const stepStartTick = idx * TICKS_PER_STEP;
    const stepEndTick   = stepStartTick + TICKS_PER_STEP;
    const tickToSec     = stepDur / TICKS_PER_STEP;
    for (let ti = 0; ti < this.pattern.extraPolyTracks.length; ti++) {
      const track = this.pattern.extraPolyTracks[ti];
      if (!track.enabled || track.notes.length === 0) continue;
      for (const n of track.notes) {
        if (n.start < stepStartTick || n.start >= stepEndTick) continue;
        const offsetSec = (n.start - stepStartTick) * tickToSec;
        const durSec = Math.max(0.01, n.duration * tickToSec);
        const accent = n.velocity >= 100;
        this.onExtraPolyTrigger?.(ti, n.midi, time + offsetSec, durSec, accent);
      }
    }

    if (this.pattern.polyMode === 'piano') {
      for (const n of this.pattern.polyNotes) {
        if (n.start < stepStartTick || n.start >= stepEndTick) continue;
        const offsetSec = (n.start - stepStartTick) * tickToSec;
        const durSec = Math.max(0.01, n.duration * tickToSec);
        const accent = n.velocity >= 100;
        if (this.onMelodyTrigger) this.onMelodyTrigger(n.midi, time + offsetSec, durSec, accent);
        else this.polysynth.trigger(n.midi, time + offsetSec, durSec, accent);
      }
    } else {
      const mel = this.pattern.melody[idx];
      if (mel.on && mel.notes.length > 0) {
        const gate = mel.tie ? stepDur * 1.6 : stepDur * 0.9;
        for (const n of mel.notes) {
          if (this.onMelodyTrigger) this.onMelodyTrigger(n, time, gate, mel.accent);
          else this.polysynth.trigger(n, time, gate, mel.accent);
        }
      }
    }

    if (this.onStep) {
      const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
      window.setTimeout(() => this.onStep?.(idx), delayMs);
    }
    for (const es of this.engineSequencers) {
      es.highlight(idx);
    }
  }
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
