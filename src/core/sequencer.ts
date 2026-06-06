import type { EngineSequencer } from '../engines/engine-types';
import { midiToFreq } from './notes';
import { DEFAULT_METER, type TimeSignature } from './meter';
export { midiToFreq };

// Step types retained for the load-time migration of old saves (notes.ts
// bassStepsToNotes/stepsToNotes/drumStepsToNotes → NoteEvent[]). They are no
// longer part of any live runtime pattern.
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

// The master clock. After the Classic pattern was removed it is just a 25 ms
// look-ahead timer that drives `sessionTick`; the Session host owns all
// per-lane scheduling. `length` survives as the default new-clip length (bars
// selector) — it no longer sizes any pattern.
export class Sequencer {
  bpm = 130;
  swing = 0;             // 0..0.6, applied to odd 16ths
  /** Global time signature (like bpm). Read at schedule/draw time so a change
   *  takes effect on the next loop cycle. Persisted in SavedStateV3. */
  meter: TimeSignature = { ...DEFAULT_METER };
  length: number;        // master/default length in 16th steps (bars * 16)

  /** Session-mode tick hook. Called every scheduler tick with (currentTime,
   *  lookaheadSec). The session host owns per-lane scheduling. */
  sessionTick?: (now: number, lookahead: number) => void;
  /** Always true — the app is session-only. Retained as a readable field so
   *  existing callers that set it to `true` at boot are harmless no-ops. */
  sessionMode: boolean = true;

  /** Fired on every idle→playing transition, from ANY start path (top transport
   *  ▶, scene launch, clip launch, MIDI-import launch). Centralizing it here is
   *  what lets the armed live-take begin recording no matter how playback was
   *  started — wiring it only to the ▶ button missed scene/clip launches. */
  onStart?: () => void;

  private playing = false;
  private timerId: number | null = null;
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
    this.length = length;
  }

  isPlaying() { return this.playing; }

  start() {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.playing = true;
    // Notify BEFORE the first tick so a live-take captures from the true downbeat.
    this.onStart?.();
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
    this.length = n;
    for (const es of this.engineSequencers) {
      es.setLength(n);
    }
  }

  private tick = () => {
    if (!this.playing) return;
    const lookahead = 0.12;
    // Session mode: host owns per-lane scheduling via sessionTick → tickSession.
    if (this.sessionTick) this.sessionTick(this.ctx.currentTime, lookahead);
    if (this.playing) this.timerId = window.setTimeout(this.tick, 25);
  };
}
