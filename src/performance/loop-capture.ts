// src/performance/loop-capture.ts
// Bar-quantized loop capture: the pure arithmetic and (below) the state
// machine that drives the recorder worklet's sample-accurate window.
// The bar clock is the transport's: boundaries sit on the grid anchored at
// `anchorSec` (ArrangementPlayState.startedAtCtx), spaced `barSec` apart.

const EPS = 1e-9; // float guard: a press landing 1e-12 past a boundary IS on it

/** The next bar boundary at or after `nowSec` (an exact hit returns itself). */
export function nextBarBoundarySec(nowSec: number, anchorSec: number, barSec: number): number {
  const k = Math.ceil((nowSec - anchorSec) / barSec - EPS);
  return anchorSec + Math.max(0, k) * barSec;
}

/** The last bar boundary at or before `nowSec` (never before the anchor). */
export function lastBarBoundarySec(nowSec: number, anchorSec: number, barSec: number): number {
  const k = Math.floor((nowSec - anchorSec) / barSec + EPS);
  return anchorSec + Math.max(0, k) * barSec;
}

export type LoopCaptureState = 'idle' | 'waiting' | 'recording' | 'finalizing';

export interface CaptureTake { left: Float32Array; right: Float32Array; sampleRate: number }

/** The live tap → worklet chain, already connected. Built by the app wiring;
 *  the controller only moves its window and tears it down. */
export interface CaptureSession {
  setWindow(startSec: number, endSec: number): void;
  cancel(): void;
}

export interface LoopCaptureDeps {
  now(): number;
  barSec(): number;
  anchorCtx(): number;
  isPlaying(): boolean;
  startTransport(): void;
  openSession(onDone: (take: CaptureTake) => void): Promise<CaptureSession>;
  deliver(take: CaptureTake, startSongSec: number): void;
  onState(s: LoopCaptureState): void;
  onError(message: string): void;
}

export class LoopCaptureController {
  private state: LoopCaptureState = 'idle';
  private session: CaptureSession | null = null;
  private startCtx = 0;
  private startSongSec = 0;
  /** The bar grid, FROZEN at capture start. An A-B loop wrap re-anchors the
   *  live ArrangementPlayState with scheduling jitter; cutting against the
   *  live anchor delivered 3.014 bars instead of 3. The grid a capture counts
   *  on is the grid it started on. */
  private anchor = 0;
  /** Bumped on every cancel/teardown so a late worklet `done` is ignored. */
  private generation = 0;

  constructor(private deps: LoopCaptureDeps) {}

  getState(): LoopCaptureState { return this.state; }

  info(): { state: LoopCaptureState; startSongSec: number; barsElapsed: number } {
    const bars = this.state === 'recording' || this.state === 'finalizing'
      ? Math.max(0, Math.floor((this.deps.now() - this.startCtx) / this.deps.barSec()))
      : 0;
    return { state: this.state, startSongSec: this.startSongSec, barsElapsed: bars };
  }

  /** ● : idle→waiting · waiting→cancel (changed your mind) · recording→stop
   *  at the end of the current bar. */
  async toggle(): Promise<void> {
    if (this.state === 'waiting') { this.cancel(); return; }
    if (this.state === 'recording') {
      this.stopAt(nextBarBoundarySec(this.deps.now(), this.anchor, this.deps.barSec()));
      return;
    }
    if (this.state !== 'idle') return; // finalizing: the take is already on its way
    if (!this.deps.isPlaying()) this.deps.startTransport();
    const gen = ++this.generation;
    try {
      const session = await this.deps.openSession((take) => {
        if (gen !== this.generation) return; // cancelled while the tail rendered
        this.session = null;
        this.deps.deliver(take, this.startSongSec);
        this.setState('idle');
      });
      if (gen !== this.generation) { session.cancel(); return; } // cancelled mid-open
      this.session = session;
      this.anchor = this.deps.anchorCtx();
      this.startCtx = nextBarBoundarySec(this.deps.now(), this.anchor, this.deps.barSec());
      this.startSongSec = this.startCtx - this.anchor;
      session.setWindow(this.startCtx, Infinity);
      this.setState('waiting');
    } catch (err) {
      this.generation++;
      this.setState('idle');
      this.deps.onError('Could not start capture: ' + ((err as Error)?.message ?? String(err)));
    }
  }

  /** Escape: abort whatever is in flight, no take. */
  cancel(): void {
    if (this.state === 'idle') return;
    this.generation++;
    this.session?.cancel();
    this.session = null;
    this.setState('idle');
  }

  /** ⏹ while recording: keep the whole bars already played, drop the rest. */
  onTransportStop(): void {
    if (this.state === 'waiting') { this.cancel(); return; }
    if (this.state !== 'recording') return;
    const lastBar = lastBarBoundarySec(this.deps.now(), this.anchor, this.deps.barSec());
    if (lastBar <= this.startCtx) { this.cancel(); return; }
    this.stopAt(lastBar);
  }

  /** Leaving the Arrange view: a countdown aborts, a recording carries on. */
  onViewLeft(): void {
    if (this.state === 'waiting') this.cancel();
  }

  /** Per-RAF: promote waiting→recording once the start bar has passed. */
  pump(): void {
    if (this.state === 'waiting' && this.deps.now() >= this.startCtx) this.setState('recording');
  }

  private stopAt(endCtx: number): void {
    this.session?.setWindow(this.startCtx, endCtx);
    this.setState('finalizing');
  }

  private setState(s: LoopCaptureState): void {
    this.state = s;
    this.deps.onState(s);
  }
}
