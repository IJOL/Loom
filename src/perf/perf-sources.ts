// Impure layer: installs every live performance hook on open and tears them all
// down on detach. The PerfMonitor stays pure; this module owns timers, the
// factory wrap, the renderCapacity subscription and the FPS rAF.

import type { PerfMonitor } from './perf-monitor';
import type { Sequencer } from '../core/sequencer';

/** Mutable holder threaded into trigger-dispatch at boot. The perf tool sets
 *  `fn` on open and clears it on close, so the dispatch seam stays a no-op when
 *  the tool is closed. */
export interface PerfVoiceTap {
  fn: ((laneId: string, gateSec: number) => void) | null;
}

interface RenderCapacityLike {
  averageLoad: number;
  peakLoad: number;
  underrunRatio: number;
  update(opts: { updateInterval: number }): void;
  addEventListener(type: 'update', cb: () => void): void;
  removeEventListener(type: 'update', cb: () => void): void;
}

const GEN_FACTORIES = ['createOscillator', 'createBufferSource', 'createConstantSource'] as const;
type GenFactory = typeof GEN_FACTORIES[number];

export interface PerfSourcesDeps {
  monitor: PerfMonitor;
  ctx: AudioContext;
  seq: Sequencer;
  voiceTap: PerfVoiceTap;
  /** Optional master-output analyser (tap off masterComp.output) for the
   *  peak/clip indicator. Absent ⇒ no master metering. */
  masterAnalyser?: AnalyserNode;
  /** Optional master limiter, for its gain-reduction reading. */
  masterComp?: { getReduction(): number };
}

export function attachPerfSources(deps: PerfSourcesDeps): () => void {
  const { monitor, ctx, seq, voiceTap } = deps;
  const nowSec = () => performance.now() / 1000;

  // 1) Scheduler lag + sessionTick duration.
  seq.onTickStats = (lagMs, tickDurMs) => monitor.recordTick(lagMs, tickDurMs, nowSec());

  // 2) Per-lane voice counting. Increment on fire; decrement at the gate end.
  //    Approximate (ignores release tails) but precise enough to spot "lane X
  //    fires N voices". Pending timers are cleared on detach.
  const timers = new Set<ReturnType<typeof setTimeout>>();
  voiceTap.fn = (laneId, gateSec) => {
    monitor.incVoice(laneId);
    const id = setTimeout(() => { monitor.decVoice(laneId); timers.delete(id); }, Math.max(0, gateSec) * 1000);
    timers.add(id);
  };

  // 3) Live generator-node count: wrap the source factories, decrement on 'ended'.
  //    addEventListener (not .onended=) so we never clobber engine cleanup handlers.
  const originals = new Map<GenFactory, unknown>();
  for (const name of GEN_FACTORIES) {
    const orig = (ctx as unknown as Record<string, unknown>)[name];
    if (typeof orig !== 'function') continue;
    originals.set(name, orig);
    (ctx as unknown as Record<string, unknown>)[name] = function (this: AudioContext, ...args: unknown[]) {
      const node = (orig as (...a: unknown[]) => unknown).apply(this, args) as { addEventListener?: (t: string, cb: () => void) => void };
      monitor.incNode();
      try { node.addEventListener?.('ended', () => monitor.decNode()); } catch { /* no ended */ }
      return node;
    };
  }

  // 4) Audio-thread load via renderCapacity (Chromium). Fallback: mark unsupported.
  const rc = (ctx as unknown as { renderCapacity?: RenderCapacityLike }).renderCapacity;
  let rcHandler: (() => void) | null = null;
  if (rc) {
    monitor.markAudioSupported(true);
    rcHandler = () => monitor.recordAudioLoad(rc.averageLoad, rc.peakLoad, rc.underrunRatio, nowSec());
    rc.addEventListener('update', rcHandler);
    rc.update({ updateInterval: 0.5 });
  } else {
    monitor.markAudioSupported(false);
  }

  // 5) FPS / main-thread frame time. `detached` guards the self-reschedule so a
  // detach() that lands mid-frame can't be undone by the callback re-queuing.
  // 5b) Master peak/clip + limiter gain reduction, sampled each frame.
  const masterAnalyser = deps.masterAnalyser;
  const masterComp = deps.masterComp;
  const masterBuf = masterAnalyser ? new Float32Array(masterAnalyser.fftSize) : null;

  const hasRaf = typeof requestAnimationFrame === 'function';
  let rafId = 0;
  let lastFrame = 0;
  let detached = false;
  const frame = (t: number) => {
    if (detached) return;
    if (lastFrame !== 0) {
      const dt = t - lastFrame;
      if (dt > 0) monitor.recordFps(1000 / dt, dt);
    }
    lastFrame = t;
    if (masterAnalyser && masterBuf) {
      masterAnalyser.getFloatTimeDomainData(masterBuf);
      let peak = 0;
      for (let i = 0; i < masterBuf.length; i++) {
        const a = Math.abs(masterBuf[i]);
        if (a > peak) peak = a;
      }
      monitor.recordMaster(peak, masterComp ? masterComp.getReduction() : 0, nowSec());
    }
    rafId = requestAnimationFrame(frame);
  };
  if (hasRaf) rafId = requestAnimationFrame(frame);

  return function detach() {
    detached = true;
    seq.onTickStats = undefined;
    voiceTap.fn = null;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const [name, orig] of originals) {
      (ctx as unknown as Record<string, unknown>)[name] = orig;
    }
    if (rc && rcHandler) rc.removeEventListener('update', rcHandler);
    if (hasRaf && rafId) cancelAnimationFrame(rafId);
  };
}
