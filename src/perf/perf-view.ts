// HUD + expandable detail panel, one lit template repainted per snapshot —
// lit dirty-checks each binding, so an unchanged number costs no DOM write
// (same economy the old hand-rolled `set()` had). The paint cadence
// (throttle) is owned by the controller, not here.

import { html, render, type TemplateResult } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
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
  const el = renderElement<HTMLElement>(html`<div class="perf-diag"></div>`);

  // Last snapshot rendered, so toggling the panel open refills it from current
  // data immediately — no stale flash and no empty flash before the next paint.
  let last: PerfSnapshot | null = null;
  let expanded = false;

  const toggle = () => { expanded = !expanded; paint(); };

  const tpl = (): TemplateResult => {
    const s = last;
    let audio = '', loadSpark = '', sched = '', lagSpark = '', fps = '', fpsSpark = '', voices = '', master = '';
    if (s) {
      audio = s.audioSupported ? `${Math.round(s.avgLoad * 100)}% / ${Math.round(s.peakLoad * 100)}%` : 'n/d';
      loadSpark = s.audioSupported ? spark(s.histLoad, 1) : '';
      sched = `${s.lagMs >= 0 ? '+' : ''}${Math.round(s.lagMs)}ms (max ${Math.round(s.lagMaxMs)})`;
      lagSpark = spark(s.histLag, 60);
      fps = `${Math.round(s.fps)} (${s.frameMs.toFixed(1)}ms)`;
      fpsSpark = spark(s.histFps, 60);
      voices = `V ${s.voicesTotal}  N ${s.genNodes}`;
      // Master peak (dBFS) + limiter gain reduction + clip onsets — the
      // indicators that track audible damage on a hot multi-lane mix.
      const pkDb = s.masterPeak > 0 ? 20 * Math.log10(s.masterPeak) : -Infinity;
      const pk = pkDb === -Infinity ? '-∞' : `${pkDb >= 0 ? '+' : ''}${pkDb.toFixed(1)}`;
      const gr = s.masterReductionDb < -0.1 ? `  GR ${s.masterReductionDb.toFixed(1)}` : '';
      const clip = s.masterClips > 0 ? `  CLIP×${s.masterClips}` : '';
      master = `pk ${pk} dBFS${gr}${clip}`;
    }
    // Panel strings computed only while expanded — same laziness the old
    // fillPanel had; a collapsed panel costs nothing per paint.
    const lanes = expanded && s
      ? (s.voicesByLane.map((l) => `${name(l.laneId)}: ${l.count}`).join('   ') || 'no active voices') : '';
    const log = expanded && s
      ? (s.events.map((e) => `${e.tSec.toFixed(1)}s  ${e.detail}`).join('\n') || 'no dropouts logged') : '';
    return html`
      <div class="perf-diag-hud">
        <button class="perf-diag-expand" data-f="expand" title="Expand / collapse details" @click=${toggle}>⤢</button>
        <div class="perf-diag-row"><span class="perf-diag-k">Audio</span><span class="perf-diag-v" data-f="audio">${audio}</span><span class="perf-diag-spark" data-s="load">${loadSpark}</span></div>
        <div class="perf-diag-row"><span class="perf-diag-k">Sched</span><span class="perf-diag-v" data-f="sched">${sched}</span><span class="perf-diag-spark" data-s="lag">${lagSpark}</span></div>
        <div class="perf-diag-row"><span class="perf-diag-k">FPS</span><span class="perf-diag-v" data-f="fps">${fps}</span><span class="perf-diag-spark" data-s="fps">${fpsSpark}</span></div>
        <div class="perf-diag-row"><span class="perf-diag-k">Load</span><span class="perf-diag-v" data-f="voices">${voices}</span></div>
        <div class="perf-diag-row"><span class="perf-diag-k">Master</span><span class="perf-diag-v" data-f="master">${master}</span></div>
      </div>
      <div class="perf-diag-panel" data-f="panel" ?hidden=${!expanded}>
        <div class="perf-diag-sub">Voices by lane</div>
        <div class="perf-diag-lanes" data-f="lanes">${lanes}</div>
        <div class="perf-diag-sub">Dropout log</div>
        <pre class="perf-diag-log" data-f="log">${log}</pre>
      </div>`;
  };

  const paint = () => render(tpl(), el);
  paint();

  return {
    el,
    render(s) {
      last = s;
      paint();
    },
    dispose() { el.remove(); },
  };
}
