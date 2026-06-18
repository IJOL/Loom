// Pure performance-metrics collector. No DOM, no audio, no timers — it only
// receives samples (pushed by perf-sources) and produces immutable snapshots
// for the view. Kept pure so it is exhaustively unit-testable.

export interface PerfEvent {
  tSec: number;
  kind: 'late-tick' | 'underrun';
  detail: string;
}

export interface PerfSnapshot {
  audioSupported: boolean;
  avgLoad: number; peakLoad: number; underrunRatio: number;
  lagMs: number; lagMaxMs: number; tickDurMs: number;
  fps: number; frameMs: number;
  voicesTotal: number;
  voicesByLane: Array<{ laneId: string; count: number }>;
  genNodes: number;
  histLoad: number[]; histLag: number[]; histFps: number[];
  events: PerfEvent[];
}

const HIST = 120;        // ring length (~12s of samples)
const EVENTS_CAP = 50;
/** A tick whose gap exceeds nominal + this many ms is logged. The scheduler
 *  fires every 25ms with a 120ms look-ahead window; +50ms (≈75ms gap) is a
 *  meaningful hiccup worth surfacing before it reaches the 120ms danger line. */
export const LATE_TICK_MS = 50;

export class PerfMonitor {
  private histLoad: number[] = [];
  private histLag: number[] = [];
  private histFps: number[] = [];
  private events: PerfEvent[] = [];
  private voices = new Map<string, number>();
  private audioSupported = false;
  private avgLoad = 0; private peakLoad = 0; private underrunRatio = 0;
  private lagMs = 0; private lagMaxMs = 0; private tickDurMs = 0;
  private fps = 0; private frameMs = 0;
  private genNodes = 0;

  private push(arr: number[], v: number): void {
    arr.push(v);
    if (arr.length > HIST) arr.shift();
  }
  private logEvent(e: PerfEvent): void {
    this.events.unshift(e);
    if (this.events.length > EVENTS_CAP) this.events.pop();
  }

  markAudioSupported(s: boolean): void { this.audioSupported = s; }

  recordTick(lagMs: number, tickDurMs: number, nowSec: number): void {
    this.lagMs = lagMs;
    this.tickDurMs = tickDurMs;
    if (lagMs > this.lagMaxMs) this.lagMaxMs = lagMs;
    this.push(this.histLag, lagMs);
    if (lagMs >= LATE_TICK_MS) {
      this.logEvent({ tSec: nowSec, kind: 'late-tick', detail: `late tick +${Math.round(lagMs)}ms` });
    }
  }

  recordAudioLoad(avg: number, peak: number, underrunRatio: number, nowSec: number): void {
    this.audioSupported = true;
    this.avgLoad = avg;
    this.peakLoad = peak;
    this.underrunRatio = underrunRatio;
    this.push(this.histLoad, avg);
    if (underrunRatio > 0) {
      this.logEvent({ tSec: nowSec, kind: 'underrun', detail: `underrun (audio) ${(underrunRatio * 100).toFixed(1)}%` });
    }
  }

  recordFps(fps: number, frameMs: number): void {
    this.fps = fps;
    this.frameMs = frameMs;
    this.push(this.histFps, fps);
  }

  incVoice(laneId: string): void {
    this.voices.set(laneId, (this.voices.get(laneId) ?? 0) + 1);
  }
  decVoice(laneId: string): void {
    const n = (this.voices.get(laneId) ?? 0) - 1;
    if (n <= 0) this.voices.delete(laneId);
    else this.voices.set(laneId, n);
  }
  incNode(): void { this.genNodes++; }
  decNode(): void { if (this.genNodes > 0) this.genNodes--; }

  snapshot(): PerfSnapshot {
    let total = 0;
    const byLane: Array<{ laneId: string; count: number }> = [];
    for (const [laneId, count] of this.voices) { total += count; byLane.push({ laneId, count }); }
    byLane.sort((a, b) => b.count - a.count);
    return {
      audioSupported: this.audioSupported,
      avgLoad: this.avgLoad, peakLoad: this.peakLoad, underrunRatio: this.underrunRatio,
      lagMs: this.lagMs, lagMaxMs: this.lagMaxMs, tickDurMs: this.tickDurMs,
      fps: this.fps, frameMs: this.frameMs,
      voicesTotal: total, voicesByLane: byLane, genNodes: this.genNodes,
      histLoad: this.histLoad.slice(), histLag: this.histLag.slice(), histFps: this.histFps.slice(),
      events: this.events.slice(),
    };
  }
}
