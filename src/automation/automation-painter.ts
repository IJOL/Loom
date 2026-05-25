// Drawing helpers for automation lanes: canvas painter, lane drawing, snap.
import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { Sequencer } from '../core/sequencer';

export type AutoBrush = 'line' | 'flat';

export interface PainterDeps {
  seq: Sequencer;
  getAutoAbsSubIdx: () => number;
}

export function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

export function formatNum(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}

// ── Migration helpers ──────────────────────────────────────────────────────

export function ensureLaneSize(
  lane: { values: number[]; stepped?: boolean; lengthBars?: number },
  seqLength: number,
): void {
  if (lane.lengthBars == null) {
    lane.lengthBars = Math.max(1, seqLength / 16);
  }
  const expected = lane.lengthBars * 16 * AUTOMATION_SUB_RES;
  if (lane.values.length === expected) return;
  // Step-per-value migration: expand to sub-res.
  if (lane.values.length === seqLength) {
    const expanded: number[] = [];
    for (let s = 0; s < seqLength; s++) {
      const v = lane.values[s];
      for (let r = 0; r < AUTOMATION_SUB_RES; r++) expanded.push(v);
    }
    lane.values = expanded;
  }
  if (lane.values.length < expected) {
    const last = lane.values[lane.values.length - 1] ?? 0.5;
    while (lane.values.length < expected) lane.values.push(last);
  } else if (lane.values.length > expected) {
    lane.values.length = expected;
  }
}

export function snapLaneToSteps(lane: { values: number[]; lengthBars?: number }): void {
  const totalSteps = (lane.lengthBars ?? 1) * 16;
  for (let s = 0; s < totalSteps; s++) {
    const start = s * AUTOMATION_SUB_RES;
    if (start >= lane.values.length) break;
    const v = lane.values[start];
    for (let i = 1; i < AUTOMATION_SUB_RES && start + i < lane.values.length; i++) {
      lane.values[start + i] = v;
    }
  }
}

// ── Canvas drawing ─────────────────────────────────────────────────────────

export function drawLane(
  canvas: HTMLCanvasElement,
  lane: { values: number[]; enabled: boolean; stepped?: boolean },
  deps: PainterDeps,
): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  const w = canvas.width, h = canvas.height;
  c.fillStyle = lane.enabled ? '#0a0a0a' : '#181818';
  c.fillRect(0, 0, w, h);

  const n = lane.values.length;
  const stepCount = Math.max(1, Math.round(n / AUTOMATION_SUB_RES));

  for (let s = 0; s <= stepCount; s++) {
    const x = (s / stepCount) * w;
    if (s % 16 === 0 && s > 0) c.strokeStyle = '#555';
    else if (s % 4 === 0) c.strokeStyle = '#2a2a2a';
    else c.strokeStyle = '#1a1a1a';
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
  c.strokeStyle = '#222';
  c.beginPath(); c.moveTo(0, h * 0.5); c.lineTo(w, h * 0.5); c.stroke();

  const xFor = (i: number) => (i / Math.max(1, n - 1)) * w;
  const yFor = (v: number) => h - v * h;

  c.fillStyle = lane.enabled ? 'rgba(52, 152, 219, 0.35)' : 'rgba(80, 80, 80, 0.25)';
  c.beginPath();
  c.moveTo(0, h);
  for (let i = 0; i < n; i++) c.lineTo(xFor(i), yFor(lane.values[i]));
  c.lineTo(w, h);
  c.closePath();
  c.fill();

  c.strokeStyle = lane.enabled ? '#3498db' : '#555';
  c.lineWidth = 1.5;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xFor(i), y = yFor(lane.values[i]);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();

  if (deps.seq.isPlaying()) {
    const idxInLane = deps.getAutoAbsSubIdx() % n;
    const x = xFor(idxInLane);
    c.strokeStyle = '#f7d000';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
}

// ── Pointer painter ────────────────────────────────────────────────────────

export function attachLanePainter(
  canvas: HTMLCanvasElement,
  lane: { values: number[]; stepped?: boolean },
  draw: () => void,
  getBrush: () => AutoBrush,
): void {
  let dragging = false;
  let lastIdx = -1;
  let initialValue = 0;

  const pointerToSubVal = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    const subIdx = Math.min(lane.values.length - 1, Math.floor(x * lane.values.length));
    const value = 1 - y;
    return { subIdx, value };
  };

  const paint = (fromIdx: number, toIdx: number, fromV: number, toV: number) => {
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    const brush = getBrush();
    if (lo === hi) {
      lane.values[lo] = brush === 'flat' ? initialValue : toV;
    } else {
      const span = toIdx - fromIdx;
      for (let i = lo; i <= hi; i++) {
        if (brush === 'flat') {
          lane.values[i] = initialValue;
        } else {
          const t = span === 0 ? 1 : (i - fromIdx) / span;
          lane.values[i] = clamp01(fromV + (toV - fromV) * t);
        }
      }
    }
    if (lane.stepped) snapLaneToSteps(lane);
  };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    const { subIdx, value } = pointerToSubVal(e);
    initialValue = value;
    lastIdx = subIdx;
    lane.values[subIdx] = value;
    if (lane.stepped) snapLaneToSteps(lane);
    draw();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { subIdx, value } = pointerToSubVal(e);
    paint(lastIdx, subIdx, lane.values[lastIdx], value);
    lastIdx = subIdx;
    draw();
  });
  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('dblclick', (e) => {
    const { subIdx } = pointerToSubVal(e as unknown as PointerEvent);
    const step = Math.floor(subIdx / AUTOMATION_SUB_RES);
    const start = step * AUTOMATION_SUB_RES;
    for (let i = 0; i < AUTOMATION_SUB_RES && start + i < lane.values.length; i++) {
      lane.values[start + i] = 0.5;
    }
    draw();
  });
}
