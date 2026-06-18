// Controller: ties PerfMonitor + perf-sources + perf-view together behind a
// single toggle and a throttled (~10Hz) paint loop. Everything is created on
// open and destroyed on close, so the tool costs nothing while closed.

import { PerfMonitor } from './perf-monitor';
import { attachPerfSources, type PerfVoiceTap } from './perf-sources';
import { createPerfView, type PerfView } from './perf-view';
import type { Sequencer } from '../core/sequencer';

export interface PerfDiagnosticsDeps {
  ctx: AudioContext;
  seq: Sequencer;
  voiceTap: PerfVoiceTap;
  mount: HTMLElement;
  resolveLaneName?: (laneId: string) => string;
}

export interface PerfDiagnostics {
  toggle(): void;
  isOpen(): boolean;
}

const PAINT_MS = 100; // ~10Hz — keeps the panel from perturbing what it measures.

export function createPerfDiagnostics(deps: PerfDiagnosticsDeps): PerfDiagnostics {
  let open = false;
  let detach: (() => void) | null = null;
  let view: PerfView | null = null;
  let monitor: PerfMonitor | null = null;
  let rafId = 0;
  let lastPaint = 0;
  const hasRaf = typeof requestAnimationFrame === 'function';

  const loop = (t: number) => {
    if (!open) return;
    if (t - lastPaint >= PAINT_MS) { lastPaint = t; view!.render(monitor!.snapshot()); }
    rafId = requestAnimationFrame(loop);
  };

  function start() {
    monitor = new PerfMonitor();
    view = createPerfView({ resolveLaneName: deps.resolveLaneName });
    deps.mount.appendChild(view.el);
    detach = attachPerfSources({ monitor, ctx: deps.ctx, seq: deps.seq, voiceTap: deps.voiceTap });
    view.render(monitor.snapshot()); // immediate first paint
    lastPaint = 0;
    if (hasRaf) rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (hasRaf && rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    detach?.(); detach = null;
    view?.dispose(); view = null;
    monitor = null;
  }

  return {
    toggle() { open = !open; if (open) start(); else stop(); },
    isOpen() { return open; },
  };
}
