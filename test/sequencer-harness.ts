// test/sequencer-harness.ts
// Layer-2 harness: real Sequencer with audio dependencies present (so
// construction doesn't blow up) but trigger callbacks redirected into an
// in-memory event log. Drives the scheduler via vi.useFakeTimers() instead
// of the wall clock.

import { vi } from 'vitest';
import { Sequencer, type BassStep, type DrumStep } from '../src/core/sequencer';
import { TB303 } from '../src/core/synth';
import { DrumMachine, DRUM_LANES, type DrumVoice } from '../src/core/drums';
import { PolySynth } from '../src/polysynth/polysynth';
import { FxBus } from '../src/core/fx';

export interface BassEvent {
  step: number;
  time: number;
  note: number;
  gate: number;
  accent: boolean;
  slidingIn: boolean;
}

export interface DrumEvent {
  step: number;
  time: number;
  lane: DrumVoice;
  accent: boolean;
}

export interface HarnessHandle {
  seq: Sequencer;
  bassLog: BassEvent[];
  drumLog: DrumEvent[];
  /** Advance both the audio clock and vitest's setTimeout queue by ms. */
  advance(ms: number): void;
  /** Tear down audio context and timers. */
  dispose(): void;
}

export interface HarnessOpts {
  bpm?: number;
  length?: number;
  bass?: BassStep[];
  drums?: Partial<Record<DrumVoice, DrumStep[]>>;
}

export function makeSchedulerHarness(opts: HarnessOpts = {}): HarnessHandle {
  vi.useFakeTimers();

  const bpm    = opts.bpm    ?? 120;
  const length = opts.length ?? 16;

  // Audio context — node-web-audio-api real instance. We don't render, we
  // only read currentTime. The sequencer also calls ctx.resume() which is
  // a no-op for a non-suspended context.
  const ctx = new AudioContext();

  // Make currentTime advance with vi's fake clock. node-web-audio-api's
  // currentTime is driven by an internal scheduler that doesn't tick under
  // fake timers, so we override the property.
  let audioNow = 0;
  Object.defineProperty(ctx as unknown as object, 'currentTime', { get: () => audioNow });

  const fx = new FxBus(ctx, ctx.destination);
  const synth = new TB303(ctx, ctx.destination);
  const drumMachine = new DrumMachine(ctx, fx, ctx.destination);
  const polysynth = new PolySynth(ctx, ctx.destination);

  const seq = new Sequencer(ctx, synth, drumMachine, polysynth, length);
  seq.bpm = bpm;

  // Seed bass / drum patterns if provided. The default emptyPattern is fine
  // for tests that don't need notes.
  if (opts.bass) {
    for (let i = 0; i < Math.min(length, opts.bass.length); i++) {
      seq.pattern.bass[i] = { ...opts.bass[i] };
    }
  }
  if (opts.drums) {
    for (const lane of DRUM_LANES) {
      const steps = opts.drums[lane];
      if (!steps) continue;
      for (let i = 0; i < Math.min(length, steps.length); i++) {
        seq.pattern.drums[lane][i] = { ...steps[i] };
      }
    }
  }

  const bassLog: BassEvent[] = [];
  const drumLog: DrumEvent[] = [];

  // Capture the audio time at start() so step indices are anchored.
  let audioStart = 0;
  const origStart = seq.start.bind(seq);
  seq.start = () => {
    audioStart = audioNow + 0.06;     // matches the +0.06 in Sequencer.start
    origStart();
  };

  // Override bass: callback replaces default trigger.
  seq.onBassTrigger = (note, time, gate, accent, slidingIn) => {
    const stepDur = 60 / seq.bpm / 4;
    const step = Math.round((time - audioStart) / stepDur);
    bassLog.push({ step, time, note, gate, accent, slidingIn });
  };

  // Drums: monkey-patch DrumMachine.trigger to log instead of synthesize.
  const origDrumTrigger = drumMachine.trigger.bind(drumMachine);
  drumMachine.trigger = (lane: DrumVoice, time: number, accent = false) => {
    const stepDur = 60 / seq.bpm / 4;
    const step = Math.round((time - audioStart) / stepDur);
    drumLog.push({ step, time, lane, accent });
    // Don't call origDrumTrigger — we don't want audio side effects.
    void origDrumTrigger;
  };

  return {
    seq,
    bassLog,
    drumLog,
    advance(ms: number): void {
      const targetNow = audioNow + ms / 1000;
      // The sequencer's tick runs setTimeout(this.tick, 25). vi.advanceTimersByTime
      // drains those callbacks, but each callback reads currentTime — we have to
      // step audioNow in fine slices so the look-ahead window admits steps gradually.
      const sliceMs = 5;
      const slices = Math.ceil(ms / sliceMs);
      for (let s = 0; s < slices; s++) {
        const stepMs = Math.min(sliceMs, ms - s * sliceMs);
        audioNow += stepMs / 1000;
        vi.advanceTimersByTime(stepMs);
      }
      audioNow = targetNow;
    },
    dispose(): void {
      seq.stop();
      vi.useRealTimers();
      void ctx.close?.();
    },
  };
}
