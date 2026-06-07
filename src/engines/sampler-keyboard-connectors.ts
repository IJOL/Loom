// src/engines/sampler-keyboard-connectors.ts
// Canvas connector lines joining each keyboard key to its channel strip — the
// mockup's "líneas del teclado a las tiras". Both ends are measured live
// (getBoundingClientRect) so it works regardless of the rack's variable column
// widths + horizontal scroll. Redraws on resize and on rack scroll.
//
// The user explicitly endorsed a canvas here ("si hace falta hazlo en un canvas").

export interface ConnPad {
  note: number;     // the pad's key (matches .smk-key[data-note])
  voice: string;    // the pad's channel (matches .dv-col[data-voice])
  color: string;
}

/** Draw connectors into `connHost` (cleared first) between the keyboard in
 *  `keyboardHost` (above) and the strips in `rackHost` (below). */
export function mountKeyboardConnectors(
  connHost: HTMLElement, keyboardHost: HTMLElement, rackHost: HTMLElement, pads: ConnPad[],
): void {
  connHost.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'smk-connectors';
  connHost.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const draw = (): void => {
    const host = connHost.getBoundingClientRect();
    const w = Math.max(1, Math.round(host.width));
    const h = Math.max(1, Math.round(host.height));
    if (canvas.width !== w) { canvas.width = w; canvas.style.width = `${w}px`; }
    if (canvas.height !== h) { canvas.height = h; canvas.style.height = `${h}px`; }
    ctx.clearRect(0, 0, w, h);
    for (const p of pads) {
      const keyEl = keyboardHost.querySelector<HTMLElement>(`.smk-key[data-note="${p.note}"]`);
      const stripEl = rackHost.querySelector<HTMLElement>(`.dv-col[data-voice="${p.voice}"]`);
      if (!keyEl || !stripEl) continue;
      const k = keyEl.getBoundingClientRect();
      const s = stripEl.getBoundingClientRect();
      const x1 = k.left + k.width / 2 - host.left;   // key centre (top)
      const x2 = s.left + s.width / 2 - host.left;    // strip centre (bottom)
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.bezierCurveTo(x1, h * 0.55, x2, h * 0.45, x2, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // Initial draw after layout, then keep it in sync with panel resize + rack scroll.
  requestAnimationFrame(draw);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => draw());
    ro.observe(connHost);
    ro.observe(rackHost);
  }
  rackHost.addEventListener('scroll', () => draw(), { passive: true });
}
