// src/session/clip-editors/warp-marker-editor.ts
// DOM overlay for editing warp markers on the audio-clip waveform (source-time
// view). Renders markers/grid/drift + a density/re-detect toolbar, and reports
// every committed change via onMarkersChange. Stateless w.r.t. the model: the
// host owns the markers (getMarkers) and applies edits in onMarkersChange.
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

  // toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'warp-toolbar';
  Object.assign(toolbar.style, { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', padding: '2px 0' });
  const dlbl = document.createElement('span'); dlbl.textContent = 'MARKERS'; dlbl.style.color = GREY;
  const sel = document.createElement('select'); sel.className = 'warp-density';
  for (const n of [1, 2, 4, 8]) {
    const o = document.createElement('option'); o.value = String(n); o.textContent = `every ${n} bar${n > 1 ? 's' : ''}`;
    if (n === barsPerMarker) o.selected = true; sel.appendChild(o);
  }
  const redetect = document.createElement('button'); redetect.className = 'warp-redetect'; redetect.textContent = '↻ Re-detect';
  const count = document.createElement('span'); count.className = 'warp-count'; count.style.color = AMBER;
  toolbar.append(dlbl, sel, redetect, count);
  host.appendChild(toolbar);

  // marker overlay
  const layer = document.createElement('div'); layer.className = 'warp-layer';
  Object.assign(layer.style, { position: 'relative', height: '82px', background: '#0c0c12', userSelect: 'none' });
  host.appendChild(layer);

  const reseed = () => {
    const m = seedSparseWarpMarkers(deps.getOnsets(), deps.downbeatSec, deps.bpm, deps.durationSec, deps.meter, barsPerMarker, deps.clipBars);
    if (m.length >= 2) deps.onMarkersChange(m, true);
  };
  sel.addEventListener('change', () => { barsPerMarker = Number(sel.value) || 4; reseed(); });
  redetect.addEventListener('click', reseed);

  const width = () => Math.max(320, deps.contentWidth?.() ?? host.clientWidth ?? 600);
  const xFor = (sec: number) => (sec / Math.max(0.001, deps.durationSec)) * width();
  const secFor = (x: number) => (x / width()) * deps.durationSec;
  const nearestOnset = (sec: number) => {
    let best = sec, d = deps.durationSec; for (const o of deps.getOnsets()) { const dd = Math.abs(o - sec); if (dd < d) { d = dd; best = o; } }
    return d < (60 / deps.bpm) * 0.5 ? best : sec;
  };

  function draw(): void {
    const w = width();
    layer.style.width = `${w}px`;
    const markers = deps.getMarkers();
    count.textContent = `${markers.length} markers`;
    // clear our own children (markers/grid/segments/drift) — leave nothing else
    [...layer.querySelectorAll('.warp-marker,.warp-grid,.warp-seg,.warp-drift')].forEach((n) => n.remove());
    const has = markers.length >= 2;
    const firstSrc = has ? markers[0].srcSec : 0;
    const lastSrc = has ? markers[markers.length - 1].srcSec : deps.durationSec;
    const lastBeat = has ? markers[markers.length - 1].beat : deps.clipBars * bpb;
    // even-grid source time a beat WOULD sit at (the "should land here" reference);
    // endpoints sit exactly on it, interior markers drift off it.
    const gridSecForBeat = (beat: number) => (lastBeat > 0 ? firstSrc + (beat / lastBeat) * (lastSrc - firstSrc) : 0);
    // alternate segment shading between markers
    for (let i = 0; i < markers.length - 1; i++) {
      const seg = document.createElement('div'); seg.className = 'warp-seg';
      Object.assign(seg.style, { position: 'absolute', top: '0', height: '100%', left: xFor(markers[i].srcSec) + 'px',
        width: (xFor(markers[i + 1].srcSec) - xFor(markers[i].srcSec)) + 'px',
        background: i % 2 ? 'rgba(245,166,35,0.05)' : 'rgba(63,208,201,0.04)', pointerEvents: 'none' });
      layer.appendChild(seg);
    }
    // faint per-bar reference grid (even division of the marked span → endpoints on grid)
    for (let bar = 0; bar <= deps.clipBars; bar++) {
      const gx = has ? xFor(gridSecForBeat(bar * bpb)) : (bar / deps.clipBars) * w;
      const g = document.createElement('div'); g.className = 'warp-grid';
      Object.assign(g.style, { position: 'absolute', top: '0', height: '100%', left: gx + 'px', width: '1px',
        background: bar % 4 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)', pointerEvents: 'none' });
      layer.appendChild(g);
    }
    // markers
    markers.forEach((mk, i) => {
      const mx = xFor(mk.srcSec);
      // drift connector: dashed line from the marker to its even-grid reference + ±ms
      if (has && i > 0 && i < markers.length - 1) {
        const gx = xFor(gridSecForBeat(mk.beat));
        if (Math.abs(mx - gx) > 1.5) {
          const con = document.createElement('div'); con.className = 'warp-drift';
          Object.assign(con.style, { position: 'absolute', top: '50%', left: Math.min(mx, gx) + 'px',
            width: Math.abs(mx - gx) + 'px', height: '0', borderTop: `1px dashed ${GREY}`, pointerEvents: 'none' });
          const ms = Math.round((mk.srcSec - gridSecForBeat(mk.beat)) * 1000);
          const dl = document.createElement('div'); dl.className = 'warp-drift'; dl.textContent = `${ms >= 0 ? '+' : ''}${ms}ms`;
          Object.assign(dl.style, { position: 'absolute', top: 'calc(50% - 13px)', left: Math.min(mx, gx) + 'px',
            fontSize: '9px', color: GREY, pointerEvents: 'none' });
          layer.append(con, dl);
        }
      }
      const el = document.createElement('div'); el.className = 'warp-marker'; (el as HTMLElement).dataset.index = String(i);
      Object.assign(el.style, { position: 'absolute', top: '0', height: '100%', left: (mx - 4) + 'px', width: '9px', cursor: 'ew-resize' });
      const line = document.createElement('div');
      Object.assign(line.style, { position: 'absolute', left: '4px', top: '0', width: '2px', height: '100%', background: AMBER });
      const handle = document.createElement('div');
      Object.assign(handle.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0',
        borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `8px solid ${AMBER}` });
      const lbl = document.createElement('div'); lbl.textContent = String(Math.round(mk.beat / bpb) + 1);
      Object.assign(lbl.style, { position: 'absolute', left: '6px', top: '9px', fontSize: '9px', color: AMBER });
      el.append(line, handle, lbl);
      // drag (interior + endpoints move srcSec; beat unchanged)
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const onMove = (e: PointerEvent) => {
          const rect = layer.getBoundingClientRect();
          const next = moveMarker(deps.getMarkers(), i, secFor(e.clientX - rect.left));
          deps.onMarkersChange(next, true);
        };
        const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
        window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
      });
      // right-click delete (interior only; deleteMarker protects endpoints)
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const cur = deps.getMarkers();
        const next = deleteMarker(cur, i);
        if (next !== cur) deps.onMarkersChange(next, true);
      });
      layer.appendChild(el);
    });
  }

  // click empty → add a marker (snap to onset; beat = nearest grid beat)
  layer.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('.warp-marker')) return;
    const rect = layer.getBoundingClientRect();
    const sec = nearestOnset(secFor(ev.clientX - rect.left));
    const beat = Math.round((sec / Math.max(0.001, deps.durationSec)) * deps.clipBars * bpb);
    const cur = deps.getMarkers();
    const next = addMarker(cur, sec, beat);
    if (next !== cur) deps.onMarkersChange(next, true);
  });

  draw();
  return { redraw: draw };
}
