// src/session/clip-editors/warp-marker-editor.ts
// DOM overlay for editing warp markers on the audio-clip waveform (source-time
// view). Renders markers/grid/drift + a density/re-detect toolbar, and reports
// every committed change via onMarkersChange. Stateless w.r.t. the model: the
// host owns the markers (getMarkers) and applies edits in onMarkersChange.
//
// The whole overlay is one lit-html template re-rendered on every redraw():
// the old imperative version removed and recreated every marker element per
// call (the host RAF drives redraw), which lit turns into a patch that no-ops
// while nothing moves. The host element is created fresh by the caller on
// every mount, so rendering straight into it is safe.
import { html, render, nothing, type TemplateResult } from 'lit-html';
import type { WarpMarker } from '../session';
import { quartersPerBar, type TimeSignature } from '../../core/meter';
import { moveMarker, addMarker, deleteMarker } from '../warp-marker-edit';
import { seedSparseWarpMarkers } from '../../samples/warp-seed-sparse';

export interface WarpMarkerEditorDeps {
  getMarkers: () => WarpMarker[];
  durationSec: number;          // FULL source-buffer duration (same coord space as the waveform header)
  downbeatSec: number;          // source time of beat 0 (the clip anchor / trimStart)
  meter: TimeSignature;
  bpm: number;
  clipBars: number;
  barsPerMarker: number;
  getOnsets: () => number[];                 // for Re-detect / density
  onMarkersChange: (markers: WarpMarker[], warp: boolean) => void;
  /** Zoomed content width (px). Defaults to host width (no zoom). */
  contentWidth?: () => number;
}
export interface WarpMarkerEditorHandle { redraw: () => void; }

const AMBER = '#f5a623', GREY = '#8a8a90';

export function mountWarpMarkerEditor(host: HTMLElement, deps: WarpMarkerEditorDeps): WarpMarkerEditorHandle {
  const bpb = Math.max(1, Math.round(quartersPerBar(deps.meter)));
  let barsPerMarker = deps.barsPerMarker;

  const reseed = () => {
    const m = seedSparseWarpMarkers(deps.getOnsets(), deps.downbeatSec, deps.bpm, deps.durationSec, deps.meter, barsPerMarker, deps.clipBars);
    if (m.length >= 2) deps.onMarkersChange(m, true);
  };
  const onDensity = (e: Event) => {
    barsPerMarker = Number((e.target as HTMLSelectElement).value) || 4; reseed();
  };

  const width = () => Math.max(320, deps.contentWidth?.() ?? host.clientWidth ?? 600);
  const xFor = (sec: number) => (sec / Math.max(0.001, deps.durationSec)) * width();
  const secFor = (x: number) => (x / width()) * deps.durationSec;
  const nearestOnset = (sec: number) => {
    let best = sec, d = deps.durationSec; for (const o of deps.getOnsets()) { const dd = Math.abs(o - sec); if (dd < d) { d = dd; best = o; } }
    return d < (60 / deps.bpm) * 0.5 ? best : sec;
  };

  // drag (interior + endpoints move srcSec; beat unchanged)
  const startDrag = (ev: PointerEvent, i: number) => {
    ev.preventDefault(); ev.stopPropagation();
    const layer = (ev.currentTarget as HTMLElement).closest('.warp-layer') as HTMLElement;
    const onMove = (e: PointerEvent) => {
      const rect = layer.getBoundingClientRect();
      const next = moveMarker(deps.getMarkers(), i, secFor(e.clientX - rect.left));
      deps.onMarkersChange(next, true);
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  // right-click delete (interior only; deleteMarker protects endpoints)
  const deleteAt = (ev: Event, i: number) => {
    ev.preventDefault(); ev.stopPropagation();
    const cur = deps.getMarkers();
    const next = deleteMarker(cur, i);
    if (next !== cur) deps.onMarkersChange(next, true);
  };

  // click empty → add a marker (snap to onset; beat = nearest grid beat)
  const onLayerDown = (ev: PointerEvent) => {
    if ((ev.target as HTMLElement).closest('.warp-marker')) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const sec = nearestOnset(secFor(ev.clientX - rect.left));
    const beat = Math.round((sec / Math.max(0.001, deps.durationSec)) * deps.clipBars * bpb);
    const cur = deps.getMarkers();
    const next = addMarker(cur, sec, beat);
    if (next !== cur) deps.onMarkersChange(next, true);
  };

  function markerTemplate(mk: WarpMarker, i: number, gridSecForBeat: (beat: number) => number, isInterior: boolean): TemplateResult {
    const mx = xFor(mk.srcSec);
    // drift connector: dashed line from the marker to its even-grid reference + ±ms
    let drift: TemplateResult | typeof nothing = nothing;
    if (isInterior) {
      const gx = xFor(gridSecForBeat(mk.beat));
      if (Math.abs(mx - gx) > 1.5) {
        const ms = Math.round((mk.srcSec - gridSecForBeat(mk.beat)) * 1000);
        drift = html`<div class="warp-drift"
            style="position:absolute;top:50%;left:${Math.min(mx, gx)}px;width:${Math.abs(mx - gx)}px;height:0;border-top:1px dashed ${GREY};pointer-events:none"></div><div
            class="warp-drift"
            style="position:absolute;top:calc(50% - 13px);left:${Math.min(mx, gx)}px;font-size:9px;color:${GREY};pointer-events:none">${ms >= 0 ? '+' : ''}${ms}ms</div>`;
      }
    }
    return html`${drift}<div class="warp-marker" data-index=${i}
        style="position:absolute;top:0;height:100%;left:${mx - 4}px;width:9px;cursor:ew-resize"
        @pointerdown=${(ev: PointerEvent) => startDrag(ev, i)}
        @contextmenu=${(ev: Event) => deleteAt(ev, i)}>
      <div style="position:absolute;left:4px;top:0;width:2px;height:100%;background:${AMBER}"></div>
      <div style="position:absolute;left:0;top:0;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:8px solid ${AMBER}"></div>
      <div style="position:absolute;left:6px;top:9px;font-size:9px;color:${AMBER}">${Math.round(mk.beat / bpb) + 1}</div>
    </div>`;
  }

  function template(): TemplateResult {
    const w = width();
    const markers = deps.getMarkers();
    const has = markers.length >= 2;
    const firstSrc = has ? markers[0].srcSec : 0;
    const lastSrc = has ? markers[markers.length - 1].srcSec : deps.durationSec;
    const lastBeat = has ? markers[markers.length - 1].beat : deps.clipBars * bpb;
    // even-grid source time a beat WOULD sit at (the "should land here" reference);
    // endpoints sit exactly on it, interior markers drift off it.
    const gridSecForBeat = (beat: number) => (lastBeat > 0 ? firstSrc + (beat / lastBeat) * (lastSrc - firstSrc) : 0);
    // alternate segment shading between markers
    const segs: TemplateResult[] = [];
    for (let i = 0; i < markers.length - 1; i++) {
      segs.push(html`<div class="warp-seg" style="position:absolute;top:0;height:100%;left:${xFor(markers[i].srcSec)}px;width:${xFor(markers[i + 1].srcSec) - xFor(markers[i].srcSec)}px;background:${i % 2 ? 'rgba(245,166,35,0.05)' : 'rgba(63,208,201,0.04)'};pointer-events:none"></div>`);
    }
    // faint per-bar reference grid (even division of the marked span → endpoints on grid)
    const gridLines: TemplateResult[] = [];
    for (let bar = 0; bar <= deps.clipBars; bar++) {
      const gx = has ? xFor(gridSecForBeat(bar * bpb)) : (bar / deps.clipBars) * w;
      gridLines.push(html`<div class="warp-grid" style="position:absolute;top:0;height:100%;left:${gx}px;width:1px;background:${bar % 4 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)'};pointer-events:none"></div>`);
    }
    return html`
      <div class="warp-toolbar" style="display:flex;gap:8px;align-items:center;font-size:11px;padding:2px 0">
        <span style="color:${GREY}">MARKERS</span>
        <select class="warp-density" @change=${onDensity}>
          ${[1, 2, 4, 8].map((n) => html`<option value=${n} ?selected=${n === barsPerMarker}>every ${n} bar${n > 1 ? 's' : ''}</option>`)}
        </select>
        <button class="warp-redetect" @click=${reseed}>↻ Re-detect</button>
        <span class="warp-count" style="color:${AMBER}">${markers.length} markers</span>
      </div>
      <div class="warp-layer" @pointerdown=${onLayerDown}
        style="position:relative;height:82px;background:#0c0c12;user-select:none;width:${w}px">
        ${segs}${gridLines}${markers.map((mk, i) => markerTemplate(mk, i, gridSecForBeat, has && i > 0 && i < markers.length - 1))}
      </div>`;
  }

  const draw = (): void => { render(template(), host); };
  draw();
  return { redraw: draw };
}
