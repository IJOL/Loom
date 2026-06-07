// src/engines/sampler-sample-viewer.ts
// The "Muestra seleccionada" panel from the mockup: select a Sampler channel and
// see THAT sample — colour swatch + filename + key + one-shot/loop badge + a
// waveform (canvas) with the loop region marked + a horizontal zoom (−/＋). The
// filename lives HERE (per the user: not on the strip; a tooltip there at most).
// Read-only for now (trim/loop-point dragging is a later refinement).

import { sampleCache } from '../samples/sample-cache';
import { sampleStore } from '../samples/store-singleton';

export interface SampleViewerOpts {
  sampleId: string;
  keyLabel: string;   // e.g. 'C2'
  color: string;      // the channel's colour
  loop: boolean;
  loopStart: number;  // 0..1 of the sample
}

// Zoom persists across re-renders (selecting another pad keeps the level).
let viewerZoom = 1;

export function renderSampleViewer(host: HTMLElement, opts: SampleViewerOpts): void {
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ssv-wrap';

  // ── Header ──
  const head = document.createElement('div');
  head.className = 'ssv-head';
  const sw = document.createElement('span');
  sw.className = 'ssv-sw';
  sw.style.background = opts.color;
  const nameEl = document.createElement('span');
  nameEl.className = 'ssv-name';
  nameEl.textContent = '…';
  const keyEl = document.createElement('span');
  keyEl.className = 'ssv-key';
  keyEl.textContent = opts.keyLabel;
  const badge = document.createElement('span');
  badge.className = 'ssv-badge';
  badge.textContent = opts.loop ? '⟳ loop' : 'one-shot';
  if (opts.loop) badge.classList.add('loop');

  const zoomCtl = document.createElement('span');
  zoomCtl.className = 'ssv-zoom';
  const zHint = document.createElement('span');
  zHint.className = 'ssv-zhint';
  zHint.textContent = 'zoom';
  const zOut = document.createElement('button');
  zOut.type = 'button'; zOut.className = 'ssv-zbtn'; zOut.textContent = '－';
  const zLvl = document.createElement('span');
  zLvl.className = 'ssv-zlvl'; zLvl.textContent = `${viewerZoom}×`;
  const zIn = document.createElement('button');
  zIn.type = 'button'; zIn.className = 'ssv-zbtn'; zIn.textContent = '＋';
  zoomCtl.append(zHint, zOut, zLvl, zIn);
  head.append(sw, nameEl, keyEl, badge, zoomCtl);
  wrap.appendChild(head);

  // ── Waveform (scrollable for zoom) ──
  const sc = document.createElement('div');
  sc.className = 'ssv-wave';
  const canvas = document.createElement('canvas');
  canvas.className = 'ssv-canvas';
  sc.appendChild(canvas);
  wrap.appendChild(sc);
  host.appendChild(wrap);

  const buf = sampleCache.get(opts.sampleId);
  const draw = (): void => drawWave(canvas, sc, buf, viewerZoom, opts);
  // Draw after layout so sc.clientWidth is known.
  requestAnimationFrame(draw);

  zOut.addEventListener('click', () => { viewerZoom = Math.max(1, viewerZoom / 2); zLvl.textContent = `${viewerZoom}×`; draw(); });
  zIn.addEventListener('click', () => { viewerZoom = Math.min(16, viewerZoom * 2); zLvl.textContent = `${viewerZoom}×`; draw(); });

  // Filename (async): the asset's original name. Falls back to the id, and tolerates
  // a store miss / no-IndexedDB env (tests) without an unhandled rejection.
  void sampleStore.get(opts.sampleId)
    .then((asset) => { const label = asset?.name ?? opts.sampleId; nameEl.textContent = label; nameEl.title = label; })
    .catch(() => { nameEl.textContent = opts.sampleId; });
}

function drawWave(
  canvas: HTMLCanvasElement, sc: HTMLElement,
  buf: AudioBuffer | undefined, zoom: number, opts: SampleViewerOpts,
): void {
  const base = Math.max(240, sc.clientWidth || 600);
  const w = Math.round(base * zoom);
  const h = 64;
  canvas.width = w; canvas.height = h;
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#080706';
  ctx.fillRect(0, 0, w, h);

  if (!buf) {
    ctx.fillStyle = '#5a5550';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('(sample not decoded yet — press Play once)', 8, h / 2);
    return;
  }

  const data = buf.getChannelData(0);
  const mid = h / 2;
  const step = data.length / w;
  ctx.fillStyle = opts.color;
  for (let x = 0; x < w; x++) {
    let s = Math.floor(x * step);
    let e = Math.floor((x + 1) * step);
    if (e <= s) e = s + 1;
    let min = 1, max = -1;
    for (let i = s; i < e && i < data.length; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) { min = 0; max = 0; }
    const y1 = mid + min * mid * 0.92;
    const y2 = mid + max * mid * 0.92;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }

  // Loop region (from loopStart to the end), amber like the mockup.
  if (opts.loop) {
    const lx = Math.max(0, Math.min(1, opts.loopStart)) * w;
    ctx.fillStyle = 'rgba(255,167,38,0.12)';
    ctx.fillRect(lx, 0, w - lx, h);
    ctx.strokeStyle = '#ffa726';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx + 0.5, 0); ctx.lineTo(lx + 0.5, h); ctx.stroke();
  }
}
