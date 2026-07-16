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
const TICK_MS = 25;          // scheduler tick cadence (ms)
const LOOKAHEAD_SEC = 0.2;   // schedule notes this far ahead — cushions tick jitter

export class Sequencer {
  bpm = 130;
  /** Shuffle: delays the off-beat 16ths. 0 = straight, SWING_MAX = hardest.
   *  Read at schedule time (like bpm) — see core/swing.ts for the mapping. */
  swing = 0;
  /** Global time signature (like bpm). Read at schedule/draw time so a change
   *  takes effect on the next loop cycle. Persisted in SavedStateV3. */
  meter: TimeSignature = { ...DEFAULT_METER };
  length: number;        // master/default length in 16th steps (bars * 16)

  /** Active song tempo map (an imported MIDI that changes tempo). When set, the
   *  transport readout shows the LIVE current BPM (bpmAtTick at the playhead) +
   *  tempo-aware position, instead of the constant `bpm`. Cleared when the user
   *  edits BPM manually or loads/imports content with no tempo map. */
  tempoMap?: import('./tempo-map').TempoMap;
  /** Total song length (Loom ticks) for the tempo map, to loop the live readout. */
  tempoSongTicks = 0;
  setTempoMap(map: import('./tempo-map').TempoMap | undefined, songTicks = 0): void {
    this.tempoMap = map; this.tempoSongTicks = songTicks;
  }

  /** Session-mode tick hook. Called every scheduler tick with (currentTime,
   *  lookaheadSec). The session host owns per-lane scheduling. */
  sessionTick?: (now: number, lookahead: number) => void;

  /** Diagnostics seam (perf-monitor). Called once per tick ONLY when set:
   *  (lagMs = gap since previous tick minus the nominal 25ms; tickDurMs =
   *  wall-clock duration of the sessionTick call). Unset in normal operation,
   *  so this costs one boolean check per tick when the perf tool is closed. */
  onTickStats?: (lagMs: number, tickDurMs: number) => void;

  /** Always true — the app is session-only. Retained as a readable field so
   *  existing callers that set it to `true` at boot are harmless no-ops. */
  sessionMode: boolean = true;

  /** Fired on every idle→playing transition, from ANY start path (top transport
   *  ▶, scene launch, clip launch, MIDI-import launch). Centralizing it here is
   *  what lets the armed live-take begin recording no matter how playback was
   *  started — wiring it only to the ▶ button missed scene/clip launches. */
  onStart?: () => void;

  private playing = false;
  private timerId: number | null = null;   // main-thread fallback timer (when no Worker)
  private clock: Worker | null = null;     // background-safe tick source (lazy, reused)
  private lastTickPerf = 0;
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
    this.lastTickPerf = 0;
    // Notify BEFORE the first tick so a live-take captures from the true downbeat.
    this.onStart?.();
    this.runTick();      // downbeat now; the clock drives every subsequent tick
    this.startClock();
  }

  stop() {
    this.playing = false;
    this.lastTickPerf = 0;
    this.clock?.postMessage({ type: 'stop' });   // halt the worker interval (worker kept for reuse)
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

  /** One scheduler pass: hand the session host the look-ahead window. Driven by
   *  the worker clock (or the fallback timer) — it does NOT self-reschedule. */
  private runTick = () => {
    if (!this.playing) return;
    const stats = this.onTickStats;
    const nowPerf = stats ? performance.now() : 0;
    const lagMs = stats ? (this.lastTickPerf ? nowPerf - this.lastTickPerf - TICK_MS : 0) : 0;
    if (stats) this.lastTickPerf = nowPerf;
    const t0 = stats ? performance.now() : 0;
    // Session mode: host owns per-lane scheduling via sessionTick → tickSession.
    if (this.sessionTick) this.sessionTick(this.ctx.currentTime, LOOKAHEAD_SEC);
    if (stats) stats(lagMs, performance.now() - t0);
  };

  /** Drive runTick from a Web Worker timer so playback survives the window being
   *  backgrounded (a main-thread timer is throttled when the tab is hidden/occluded).
   *  Falls back to a main-thread timer where Worker is unavailable (tests / SSR). */
  private startClock(): void {
    if (this.clock === null) {
      try {
        this.clock = new Worker(new URL('./clock-worker.ts', import.meta.url), { type: 'module' });
        this.clock.onmessage = () => { if (this.playing) this.runTick(); };
      } catch {
        this.clock = null;   // no Worker (e.g. test env) → main-thread fallback
      }
    }
    if (this.clock) this.clock.postMessage({ type: 'start', intervalMs: TICK_MS });
    else this.scheduleFallback();
  }

  private scheduleFallback = (): void => {
    if (!this.playing) return;
    this.timerId = setTimeout(() => {
      if (!this.playing) return;
      this.runTick();
      this.scheduleFallback();
    }, TICK_MS) as unknown as number;
  };
}
