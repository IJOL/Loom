// src/engines/sampler-sample-viewer.ts
// The "Muestra seleccionada" panel from the mockup: select a Sampler channel and
// see THAT sample — colour swatch + filename + key + one-shot/loop badge + a
// waveform (canvas) with the loop region marked + a horizontal zoom (−/＋). The
// filename lives HERE (per the user: not on the strip; a tooltip there at most).
// Handles for trim-start/end + loop-start/end are draggable; badge toggles loop.

import { html } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
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

  const buf = sampleCache.get(opts.sampleId);
  // Refs into the one-shot template below, assigned right after renderElement.
  // Every closure that reads them only runs on user events / rAF — after
  // assignment — so the forward references are safe.
  let sc!: HTMLElement;
  let canvas!: HTMLCanvasElement;
  let badge!: HTMLElement;
  let zLvl!: HTMLElement;
  const draw = (): void => drawWave(canvas, sc, buf, viewerZoom, opts);
  const setZoom = (z: number): void => {
    viewerZoom = z;
    zLvl.textContent = `${viewerZoom}×`;
    draw();
  };

  // ── Badge: clickable loop toggle ──
  const onBadgeClick = (): void => {
    const next = opts.loop ? 0 : 1;
    opts.loop = next > 0.5;
    opts.onEdit?.('loop', next);
    draw();
    badge.textContent = opts.loop ? '⟳ loop' : 'one-shot';
    badge.classList.toggle('loop', opts.loop);
  };

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
  const onPointerDown = (ev: PointerEvent): void => {
    const h = pickHandle(fracAt(ev.clientX), stateNow(), 0.02);
    if (!h) return;
    dragging = h;
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  };
  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragging) return;
    const next = applyHandle(dragging, fracAt(ev.clientX), stateNow());
    const leaf = dragging === 'start' ? 'sampleStart' : dragging === 'end' ? 'sampleEnd' : dragging;
    const value = next[leaf as keyof TrimState] as number;
    (opts as unknown as Record<string, number>)[leaf] = value; // update local opts so further drags read the new value
    draw();
    opts.onEdit?.(leaf, value);
  };
  const endDrag = (ev: PointerEvent): void => {
    if (!dragging) return;
    dragging = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
  };

  // One-shot template: the viewer is rebuilt per pad selection (its old
  // lifecycle), so it renders once and later patches (name, badge, zoom level)
  // stay imperative on the extracted refs. Canvas drawing is untouched.
  const wrap = renderElement(html`
    <div class="ssv-wrap">
      <div class="ssv-head">
        <span class="ssv-sw" style="background:${opts.color}"></span>
        <span class="ssv-name">…</span>
        <span class="ssv-key">${opts.keyLabel}</span>
        <span class=${opts.loop ? 'ssv-badge loop' : 'ssv-badge'} style="cursor:pointer"
          title="Click to toggle one-shot / loop" @click=${onBadgeClick}>${opts.loop ? '⟳ loop' : 'one-shot'}</span>
        <span class="ssv-zoom">
          <span class="ssv-zhint">zoom</span>
          <button type="button" class="ssv-zbtn" @click=${() => setZoom(Math.max(1, viewerZoom / 2))}>－</button>
          <span class="ssv-zlvl">${viewerZoom}×</span>
          <button type="button" class="ssv-zbtn" @click=${() => setZoom(Math.min(16, viewerZoom * 2))}>＋</button>
        </span>
      </div>
      <div class="ssv-wave">
        <canvas class="ssv-canvas" style="cursor:pointer" @pointerdown=${onPointerDown}
          @pointermove=${onPointerMove} @pointerup=${endDrag} @pointercancel=${endDrag}></canvas>
      </div>
    </div>`);
  sc = wrap.querySelector<HTMLElement>('.ssv-wave')!;
  canvas = wrap.querySelector<HTMLCanvasElement>('.ssv-canvas')!;
  badge = wrap.querySelector<HTMLElement>('.ssv-badge')!;
  zLvl = wrap.querySelector<HTMLElement>('.ssv-zlvl')!;
  const nameEl = wrap.querySelector<HTMLElement>('.ssv-name')!;
  host.appendChild(wrap);

  // Draw after layout so sc.clientWidth is known.
  requestAnimationFrame(draw);

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
