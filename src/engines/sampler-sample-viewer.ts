// src/engines/sampler-sample-viewer.ts
// The "Muestra seleccionada" panel from the mockup: select a Sampler channel and
// see THAT sample — colour swatch + filename + key + one-shot/loop badge + a
// waveform (canvas) with the loop region marked + a horizontal zoom (−/＋). The
// filename lives HERE (per the user: not on the strip; a tooltip there at most).
// Handles for trim-start/end + loop-start/end are draggable; badge toggles loop.

import { sampleCache } from '../samples/sample-cache';
import { sampleStore } from '../samples/store-singleton';
import { xToFrac, pickHandle, applyHandle, type TrimState, type WaveHandle } from './sampler-waveform-edit';

export interface SampleViewerOpts {
  sampleId: string;
  keyLabel: string;   // e.g. 'C2'
  color: string;      // the channel's colour
  loop: boolean;
  loopStart: number;  // 0..1 of the sample
  loopEnd: number;    // NEW
  sampleStart: number; // NEW
  sampleEnd: number;   // NEW
  /** Persist a fraction change for the selected pad. */
  onEdit?: (leaf: 'sampleStart' | 'sampleEnd' | 'loopStart' | 'loopEnd' | 'loop', value: number) => void; // NEW
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

  // ── Badge: clickable loop toggle ──
  badge.style.cursor = 'pointer';
  badge.title = 'Click to toggle one-shot / loop';
  badge.addEventListener('click', () => {
    const next = opts.loop ? 0 : 1;
    opts.loop = next > 0.5;
    opts.onEdit?.('loop', next);
    draw();
    badge.textContent = opts.loop ? '⟳ loop' : 'one-shot';
    badge.classList.toggle('loop', opts.loop);
  });

  // ── Pointer dragging on the canvas ──
  let dragging: WaveHandle | null = null;
  const stateNow = (): TrimState => ({
    sampleStart: opts.sampleStart, sampleEnd: opts.sampleEnd,
    loopStart: opts.loopStart, loopEnd: opts.loopEnd, loop: opts.loop,
  });
  const fracAt = (clientX: number): number => {
    const r = sc.getBoundingClientRect();
    return xToFrac(clientX, r.left, sc.scrollLeft, canvas.width);
  };
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('pointerdown', (ev) => {
    const h = pickHandle(fracAt(ev.clientX), stateNow(), 0.02);
    if (!h) return;
    dragging = h;
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const next = applyHandle(dragging, fracAt(ev.clientX), stateNow());
    const leaf = dragging === 'start' ? 'sampleStart' : dragging === 'end' ? 'sampleEnd' : dragging;
    const value = next[leaf as keyof TrimState] as number;
    (opts as unknown as Record<string, number>)[leaf] = value; // update local opts so further drags read the new value
    draw();
    opts.onEdit?.(leaf, value);
  });
  const endDrag = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
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

  // Trim + loop handles replacing the old single-handle loop block.
  const st = Math.min(Math.max(opts.sampleStart, 0), 1);
  const en = Math.min(Math.max(opts.sampleEnd, 0), 1);
  // dim trimmed-out regions
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, st * w, h);
  ctx.fillRect(en * w, 0, (1 - en) * w, h);
  // trim handles (amber)
  ctx.fillStyle = '#ffa726';
  ctx.fillRect(st * w - 1, 0, 2, h);
  ctx.fillRect(en * w - 1, 0, 2, h);
  // loop region (green) + its two handles, only when loop is on
  if (opts.loop) {
    const ls = Math.min(Math.max(opts.loopStart, 0), 1);
    const le = Math.min(Math.max(opts.loopEnd, 0), 1);
    ctx.fillStyle = 'rgba(124,179,66,0.20)';
    ctx.fillRect(ls * w, 0, (le - ls) * w, h);
    ctx.fillStyle = '#7cb342';
    ctx.fillRect(ls * w - 1, 0, 2, h);
    ctx.fillRect(le * w - 1, 0, 2, h);
  }
  canvas.dataset.sampleStart = st.toFixed(4);
  canvas.dataset.sampleEnd = en.toFixed(4);
  canvas.dataset.loopStart = String(opts.loopStart);
  canvas.dataset.loopEnd = String(opts.loopEnd);
  canvas.dataset.loop = opts.loop ? '1' : '0';
}
