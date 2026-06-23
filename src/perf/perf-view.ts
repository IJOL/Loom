// HUD + expandable detail panel. Pure DOM: build once, then render(snapshot)
// updates text only when it changed and fills the panel only while expanded.
// The paint cadence (throttle) is owned by the controller, not here.

import type { PerfSnapshot } from './perf-monitor';

const BARS = '▁▂▃▄▅▆▇█';

/** Cheap block-glyph sparkline of the last `n` samples, scaled to max(refMax, data). */
function spark(arr: number[], refMax: number, n = 24): string {
  if (arr.length === 0) return '';
  const slice = arr.slice(-n);
  const hi = Math.max(refMax, ...slice) || 1;
  return slice
    .map((v) => BARS[Math.min(BARS.length - 1, Math.max(0, Math.round((v / hi) * (BARS.length - 1))))])
    .join('');
}

export interface PerfViewOpts {
  resolveLaneName?: (laneId: string) => string;
}

export interface PerfView {
  el: HTMLElement;
  render(s: PerfSnapshot): void;
  dispose(): void;
}

export function createPerfView(opts: PerfViewOpts = {}): PerfView {
  const name = opts.resolveLaneName ?? ((id: string) => id);
  const el = document.createElement('div');
  el.className = 'perf-diag';
  el.innerHTML = `
    <div class="perf-diag-hud">
      <button class="perf-diag-expand" data-f="expand" title="Expand / collapse details">⤢</button>
      <div class="perf-diag-row"><span class="perf-diag-k">Audio</span><span class="perf-diag-v" data-f="audio"></span><span class="perf-diag-spark" data-s="load"></span></div>
      <div class="perf-diag-row"><span class="perf-diag-k">Sched</span><span class="perf-diag-v" data-f="sched"></span><span class="perf-diag-spark" data-s="lag"></span></div>
      <div class="perf-diag-row"><span class="perf-diag-k">FPS</span><span class="perf-diag-v" data-f="fps"></span><span class="perf-diag-spark" data-s="fps"></span></div>
      <div class="perf-diag-row"><span class="perf-diag-k">Load</span><span class="perf-diag-v" data-f="voices"></span></div>
      <div class="perf-diag-row"><span class="perf-diag-k">Master</span><span class="perf-diag-v" data-f="master"></span></div>
    </div>
    <div class="perf-diag-panel" data-f="panel" hidden>
      <div class="perf-diag-sub">Voices by lane</div>
      <div class="perf-diag-lanes" data-f="lanes"></div>
      <div class="perf-diag-sub">Dropout log</div>
      <pre class="perf-diag-log" data-f="log"></pre>
    </div>`;

  const q = (sel: string) => el.querySelector(sel) as HTMLElement;
  const panel = q('[data-f="panel"]');

  const set = (sel: string, text: string) => {
    const n = q(sel);
    if (n.textContent !== text) n.textContent = text;
  };

  // Last snapshot rendered, so toggling the panel open can refill it from
  // current data immediately — no stale flash and no empty flash before the
  // next paint. Filled only while expanded.
  let last: PerfSnapshot | null = null;
  const fillPanel = (s: PerfSnapshot) => {
    set('[data-f="lanes"]', s.voicesByLane.map((l) => `${name(l.laneId)}: ${l.count}`).join('   ') || 'no active voices');
    set('[data-f="log"]', s.events.map((e) => `${e.tSec.toFixed(1)}s  ${e.detail}`).join('\n') || 'no dropouts logged');
  };
  q('[data-f="expand"]').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && last) fillPanel(last);
  });

  return {
    el,
    render(s) {
      last = s;
      set('[data-f="audio"]', s.audioSupported ? `${Math.round(s.avgLoad * 100)}% / ${Math.round(s.peakLoad * 100)}%` : 'n/d');
      set('[data-s="load"]', s.audioSupported ? spark(s.histLoad, 1) : '');
      set('[data-f="sched"]', `${s.lagMs >= 0 ? '+' : ''}${Math.round(s.lagMs)}ms (max ${Math.round(s.lagMaxMs)})`);
      set('[data-s="lag"]', spark(s.histLag, 60));
      set('[data-f="fps"]', `${Math.round(s.fps)} (${s.frameMs.toFixed(1)}ms)`);
      set('[data-s="fps"]', spark(s.histFps, 60));
      set('[data-f="voices"]', `V ${s.voicesTotal}  N ${s.genNodes}`);
      // Master peak (dBFS) + limiter gain reduction + clip onsets — the
      // indicators that track audible damage on a hot multi-lane mix.
      const pkDb = s.masterPeak > 0 ? 20 * Math.log10(s.masterPeak) : -Infinity;
      const pk = pkDb === -Infinity ? '-∞' : `${pkDb >= 0 ? '+' : ''}${pkDb.toFixed(1)}`;
      const gr = s.masterReductionDb < -0.1 ? `  GR ${s.masterReductionDb.toFixed(1)}` : '';
      const clip = s.masterClips > 0 ? `  CLIP×${s.masterClips}` : '';
      set('[data-f="master"]', `pk ${pk} dBFS${gr}${clip}`);
      if (!panel.hidden) fillPanel(s);
    },
    dispose() { el.remove(); },
  };
}
