// src/engines/sampler-loop-overview.ts
// The WHOLE loop above the channel strips (the mockup's loop view): the slices
// concatenated back into one continuous waveform, each segment tinted its slice
// colour with a cut line at every boundary. Reconstructed from the per-slice
// buffers in the sample cache (a loop's keymap is a bank of single-note slices,
// in ascending-note order = playback order).

import { sampleCache } from '../samples/sample-cache';
import { padColor } from './sampler-keyboard-map';
import type { KeymapEntry } from '../samples/types';

/** Render the whole-loop overview into `host` (cleared first). No-op for an empty kit. */
export function renderLoopOverview(host: HTMLElement, keymap: KeymapEntry[]): void {
  host.innerHTML = '';
  if (!keymap.length) return;
  const slices = [...keymap].sort((a, b) => a.rootNote - b.rootNote);
  const buffers = slices.map((s) => sampleCache.get(s.sampleId));
  const total = buffers.reduce((sum, b) => sum + (b ? b.length : 0), 0) || 1;

  const canvas = document.createElement('canvas');
  canvas.className = 'slo-canvas';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const draw = (): void => {
    const w = Math.max(240, host.clientWidth || 600);
    const h = 56;
    if (canvas.width !== w) { canvas.width = w; canvas.style.width = `${w}px`; }
    if (canvas.height !== h) { canvas.height = h; canvas.style.height = `${h}px`; }
    ctx.fillStyle = '#080706';
    ctx.fillRect(0, 0, w, h);
    const mid = h / 2;

    let xOff = 0;
    slices.forEach((_s, i) => {
      const buf = buffers[i];
      const segW = buf ? (buf.length / total) * w : 0;
      const color = padColor(i, slices.length);
      if (buf) {
        const data = buf.getChannelData(0);
        const cols = Math.max(1, Math.round(segW));
        const step = data.length / cols;
        ctx.fillStyle = color;
        for (let x = 0; x < cols; x++) {
          let s2 = Math.floor(x * step);
          let e2 = Math.floor((x + 1) * step);
          if (e2 <= s2) e2 = s2 + 1;
          let min = 1, max = -1;
          for (let j = s2; j < e2 && j < data.length; j++) { const v = data[j]; if (v < min) min = v; if (v > max) max = v; }
          if (min > max) { min = 0; max = 0; }
          const y1 = mid + min * mid * 0.92;
          const y2 = mid + max * mid * 0.92;
          ctx.fillRect(xOff + x, y1, 1, Math.max(1, y2 - y1));
        }
      }
      // Cut line at the start of each slice (after the first).
      if (i > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xOff + 0.5, 0); ctx.lineTo(xOff + 0.5, h); ctx.stroke();
      }
      xOff += segW;
    });
  };

  requestAnimationFrame(draw);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => draw());
    ro.observe(host);
  }
}
