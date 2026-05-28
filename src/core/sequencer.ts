import type { EngineSequencer } from '../engines/engine-types';
import { emptyPattern, AUTOMATION_SUB_RES, type PatternData } from './pattern';
import { DRUM_LANES } from './drums';

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

  /** Session-mode tick hook. Called every scheduler tick with (currentTime,
   *  lookaheadSec). The session host owns per-lane scheduling. */
  sessionTick?: (now: number, lookahead: number) => void;
  /** Always true — the app is session-only. Retained as a readable field so
   *  existing callers that set it to `true` at boot are harmless no-ops. */
  sessionMode: boolean = true;

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
    // Session mode: host owns per-lane scheduling via sessionTick → tickSession.
    if (this.sessionTick) this.sessionTick(this.ctx.currentTime, lookahead);
    if (this.playing) this.timerId = window.setTimeout(this.tick, 25);
  };
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
