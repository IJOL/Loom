// src/session/clip-editors/clip-waveform-header.ts
// The waveform strip shown ABOVE the normal clip editor (the visual the user
// liked). Two exports:
//   - mountWaveformHeader: canvas (waveform + bar/beat ruler + slice markers)
//     mounted above the body editor; returns { redraw } for the host RAF.
//   - renderAudioClipEditor: the audio-clip (Mode 1) editor — waveform header +
//     a small toolbar (warp). BPM/length live in the inspector, not here. No
//     note grid.

import { html, render, nothing } from 'lit-html';
import type { SessionClip } from '../session';
import { sampleCache } from '../../samples/sample-cache';
import { ticksPerBar, stepsPerBar, stepsPerBeat, quartersPerBar, DEFAULT_METER, type TimeSignature } from '../../core/meter';
import { srcSecAtBeat } from '../../samples/warp-region';
import { setAudioClipWarp } from './audio-clip-warp';
import { buildEngineParamGrid } from '../../engines/engine-param-grid';
import type { SynthEngine, EngineUIContext } from '../../engines/engine-types';
import { mountWarpMarkerEditor } from './warp-marker-editor';
import { mountClipLoopOverlay } from '../../core/clip-loop-overlay';
import type { HistoryDeps } from '../../save/history-wiring';
import { ClipAxis } from '../../core/clip-axis';
import { attachPrimaryAxis } from '../../core/clip-axis-primary';
import { isFollowEnabled, followScrollTarget } from '../../core/clip-follow';
import { createFollowToggle } from '../../core/clip-editor-toolbar';

const RULER_H = 18;
const WAVE_H = 64;
/** Total height of the waveform strip. Exported so a caller that mounts it as a
 *  ClipAxis follower can size the follower window to match. */
export const WAVEFORM_HEADER_H = RULER_H + WAVE_H;

export interface WaveformHeaderHandle {
  redraw: () => void;
  /** Release the ClipAxis subscription (follower strip) / primary registration. */
  dispose?: () => void;
}
export interface WaveformHeaderDeps {
  getPlayheadFrac?: () => number;
  /** Zoomed content width (px). Defaults to the host width (no zoom). */
  contentWidth?: () => number;
}

/** Source buffer id used by the header: the audio clip's own sample, or a
 *  display-only waveformRef (Mode-2 sliced note clip). */
function headerSampleId(clip: SessionClip): string | undefined {
  return clip.sample?.sampleId ?? clip.waveformRef?.sampleId;
}

export function mountWaveformHeader(
  host: HTMLElement, clip: SessionClip, meter: TimeSignature = DEFAULT_METER, deps: WaveformHeaderDeps = {},
): WaveformHeaderHandle {
  // Build-once canvas: lit-render into a throwaway fragment and pull the
  // element out. The drawing below is imperative and owns the canvas wholesale.
  const frag = document.createDocumentFragment();
  render(html`<canvas class="clip-waveform-header" style="display:block;width:100%"></canvas>`, frag);
  const canvas = frag.firstElementChild as HTMLCanvasElement;
  host.appendChild(canvas);
  const c2d = canvas.getContext('2d');

  const barTicks = ticksPerBar(meter);
  const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
  const beatTicks = barTicks / beatsPerBar;
  const patternTicks = Math.max(1, clip.lengthBars * barTicks);
  let playheadFrac = -1;

  function draw(): void {
    if (!c2d) return;
    const w = Math.max(320, deps.contentWidth?.() ?? host.clientWidth ?? 600);
    const h = RULER_H + WAVE_H;
    canvas.width = w; canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    c2d.fillStyle = '#0c0c12'; c2d.fillRect(0, 0, w, h);

    // waveform
    const buf = headerSampleId(clip) ? sampleCache.get(headerSampleId(clip)!) : undefined;
    if (buf) {
      const data = buf.getChannelData(0);
      const mid = RULER_H + WAVE_H / 2;
      c2d.strokeStyle = '#4a6a8a'; c2d.beginPath();
      for (let px = 0; px < w; px++) {
        const i0 = Math.floor((px / w) * data.length);
        const i1 = Math.floor(((px + 1) / w) * data.length);
        let peak = 0; for (let i = i0; i < i1 && i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        c2d.moveTo(px, mid - peak * (WAVE_H / 2)); c2d.lineTo(px, mid + peak * (WAVE_H / 2));
      }
      c2d.stroke();
    }

    // bar/beat ruler
    for (let t = 0; t <= patternTicks; t += beatTicks) {
      const x = (t / patternTicks) * w;
      c2d.strokeStyle = (t % barTicks === 0) ? '#555' : '#2a2a2a';
      c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, RULER_H); c2d.stroke();
    }

    // slice markers (Mode-2 sliced clips carry the carve map on waveformRef)
    const slices = clip.waveformRef?.slices ?? [];
    const dur = buf?.duration ?? 0;
    if (slices.length && dur > 0) {
      c2d.strokeStyle = '#ffb454';
      for (const s of slices) {
        const x = (s.start / dur) * w;
        c2d.beginPath(); c2d.moveTo(x, RULER_H); c2d.lineTo(x, RULER_H + WAVE_H); c2d.stroke();
      }
    }

    // warp beat grid — the song's actual bar positions in the SOURCE, from the
    // shared warp markers (propagated to every channel of the import). Drawn on
    // any warped clip's waveform so beat alignment is visible everywhere, not
    // only on the drums reference. Bars at warped source x; every 4th brighter.
    const wm = clip.sample?.warpMarkers;
    if (wm && wm.length >= 2 && dur > 0) {
      const bpb = Math.max(1, Math.round(quartersPerBar(meter)));
      const lastBeat = wm[wm.length - 1].beat;
      for (let barIdx = 0; barIdx <= clip.lengthBars; barIdx++) {
        const beat = barIdx * bpb;
        if (beat > lastBeat) break;
        const x = (srcSecAtBeat(wm, beat) / dur) * w;
        c2d.strokeStyle = barIdx % 4 === 0 ? 'rgba(245,166,35,0.40)' : 'rgba(245,166,35,0.13)';
        c2d.beginPath(); c2d.moveTo(x, RULER_H); c2d.lineTo(x, RULER_H + WAVE_H); c2d.stroke();
      }
    }

    // playhead
    if (playheadFrac >= 0) {
      const x = playheadFrac * w;
      c2d.strokeStyle = '#f7d000'; c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, h); c2d.stroke();
    }
  }

  draw();
  let lastW = Math.max(320, deps.contentWidth?.() ?? host.clientWidth ?? 600);
  return {
    redraw() {
      const f = deps.getPlayheadFrac?.() ?? -1;
      const w = Math.max(320, deps.contentWidth?.() ?? host.clientWidth ?? 600);
      if (f === playheadFrac && w === lastW) return; // nothing changed — skip repaint
      playheadFrac = f;
      lastW = w;
      draw();
    },
  };
}

export interface AudioClipEditorDeps {
  getPlayheadFrac?: () => number;
  /** When present, mount the audio engine's Gain knob in the toolbar (audio
   *  lanes show their controls here, next to the waveform — not in the lane
   *  editor). */
  gain?: { engine: SynthEngine; ctx: EngineUIContext };
  /** When present + the clip sample is the warpRef, mount the editable warp
   *  marker overlay. The host supplies onset detection + the BPM + the commit
   *  callback (propagate/cache-invalidate/undo live in the router). */
  warp?: {
    getOnsets: () => number[];
    bpm: number;
    onMarkersChange: (markers: import('../session').WarpMarker[], warp: boolean) => void;
  };
  /** When present, mount the performance-style loop overlay (Loop toggle +
   *  variable quantize + draggable A/B column) over the waveform. The router
   *  supplies undo + warp-cache invalidation. */
  loop?: {
    historyDeps?: HistoryDeps;
    onChange: () => void;
    /** Returns true when the editing scene's loop is currently linked. */
    isLinked?: () => boolean;
    /** Called when the user clicks the Link toggle in the loop toolbar. */
    onToggleLink?: (linked: boolean) => void;
    /** Called after each loop edit commit (toggle + brace drags). */
    onClipLoopEdited?: () => void;
  };
  /** When present, show a "Transcribe loop" button + melodic/drums toggle that
   *  sends the clip's effective loop region to the audio→notes backend. The
   *  router binds the clip; here we only choose the kind and fire `run`. */
  transcribe?: { run: (kind: 'melodic' | 'drums') => void | Promise<void> };
  /** The clip's shared horizontal time axis. An audio clip's editor is the
   *  PRIMARY: it publishes its viewport width and drives zoom/scroll, so the
   *  automation lanes below line up with the waveform. Optional so tests can
   *  mount it standalone (it then gets a private axis and has no followers). */
  axis?: ClipAxis;
}

export function renderAudioClipEditor(
  host: HTMLElement, clip: SessionClip, meter: TimeSignature = DEFAULT_METER, deps: AudioClipEditorDeps = {},
): WaveformHeaderHandle {
  host.innerHTML = '';
  const sample = clip.sample;

  // Hoisted so the warpBtn click handler can call markerHandle?.redraw() and
  // relayout() can reach the loop overlay.
  let markerHandle: { redraw: () => void } | undefined;
  let loopHandle: { redraw: () => void } | undefined;

  // Zoom/scroll live on the clip's shared axis (this editor is the primary).
  const axis = deps.axis ?? new ClipAxis(clip.id, Math.max(1, clip.lengthBars * ticksPerBar(meter)));
  axis.setTotalTicks(Math.max(1, clip.lengthBars * ticksPerBar(meter)));

  const viewportW = () => Math.max(320, viewport.clientWidth || 600);
  const contentW = () => Math.max(1, axis.contentWidth());   // read-only: relayout() publishes the basis

  const refreshWarp = () => {
    const on = !!sample?.warp;
    warpBtn.textContent = on ? 'ON' : 'OFF';
    Object.assign(warpBtn.style, {
      background: on ? '#f5a623' : 'transparent', color: on ? '#000' : '#8a8a90',
      border: on ? '1px solid #f5a623' : '1px solid #2c2c32', fontWeight: '700',
      padding: '3px 10px', borderRadius: '3px', cursor: 'pointer',
    } as Partial<CSSStyleDeclaration>);
  };

  // Ruler-scrub zoom on the waveform strip — expressed on the shared axis, so
  // the automation lanes below zoom with it.
  const onHeaderScrub = (e: PointerEvent) => {
    let lx = e.clientX, ly = e.clientY;
    headerHost.setPointerCapture(e.pointerId); e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - ly, dx = ev.clientX - lx; lx = ev.clientX; ly = ev.clientY;
      const anchorPx = ev.clientX - viewport.getBoundingClientRect().left;
      axis.scrub(dy, anchorPx);
      axis.setScrollLeft(axis.scrollLeft - dx);
      applyAxis();
    };
    const onUp = (ev: PointerEvent) => {
      headerHost.removeEventListener('pointermove', onMove);
      headerHost.removeEventListener('pointerup', onUp);
      headerHost.removeEventListener('pointercancel', onUp);
      try { headerHost.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    };
    headerHost.addEventListener('pointermove', onMove);
    headerHost.addEventListener('pointerup', onUp);
    headerHost.addEventListener('pointercancel', onUp);
  };

  // Static scaffolding: one-shot lit template rendered into a throwaway
  // fragment, refs pulled out below. The host is innerHTML-wiped on every
  // rebuild, so lit's per-container part cache could never be trusted on it.
  // Handlers bound here only run on user events, after every ref is assigned.
  // The second (empty) content div is the warp-marker editor's mount point,
  // reserved only when it will actually mount.
  const frag = document.createDocumentFragment();
  render(html`
    <div class="audio-clip-toolbar" style="display:flex;gap:8px;align-items:center;padding:4px 2px;font-size:11px">
      <span style="color:#8a8a90;font-size:10px">WARP</span>
      <button class="audio-clip-warp" @click=${() => {
        if (sample) { setAudioClipWarp(sample, !sample.warp); refreshWarp(); markerHandle?.redraw(); }
      }}></button>
      ${deps.gain ? html`<div class="knob-row"></div>` : nothing}
      ${createFollowToggle()}
    </div>
    <div class="audio-clip-vp" style="overflow-x:auto;overflow-y:hidden;position:relative" @scroll=${() => axis.setScrollLeft(viewport.scrollLeft)}>
      <div style="position:relative">
        <div @pointerdown=${onHeaderScrub}></div>
        ${sample?.warpRef && deps.warp ? html`<div></div>` : nothing}
      </div>
    </div>`, frag);
  const toolbar = frag.children[0] as HTMLElement;
  const viewport = frag.children[1] as HTMLDivElement;
  const content = viewport.firstElementChild as HTMLDivElement;
  const headerHost = content.children[0] as HTMLDivElement;
  const warpBtn = toolbar.querySelector('.audio-clip-warp') as HTMLButtonElement;
  refreshWarp();
  if (deps.gain) {
    buildEngineParamGrid(deps.gain.engine, deps.gain.ctx,
      toolbar.querySelector('.knob-row') as HTMLElement,
      { layout: 'flat', skip: (id) => id !== 'gain' });
  }
  host.append(toolbar, viewport);

  const header = mountWaveformHeader(headerHost, clip, meter, {
    getPlayheadFrac: deps.getPlayheadFrac, contentWidth: contentW,
  });

  const relayout = () => {
    axis.setBasisWidth(viewportW());          // publish the fit basis for followers
    const cw = contentW();
    content.style.width = `${cw}px`;
    header.redraw();
    markerHandle?.redraw();
    loopHandle?.redraw();
  };

  // The shared axis moved (our scrub, our scroll, a clip-length change). The
  // guard, the relayout memo and the scroll mirroring live in attachPrimaryAxis.
  const primaryAxis = attachPrimaryAxis({
    axis,
    viewport,
    relayout: () => relayout(),
    afterApply: () => loopHandle?.redraw(),
  });
  const applyAxis = () => primaryAxis.apply();

  // Performance-style loop overlay inside the viewport (zoom-aware)
  if (deps.loop) {
    const total = clip.lengthBars * ticksPerBar(meter);
    loopHandle = mountClipLoopOverlay({
      toolbarHost: toolbar,
      scrollHost: viewport,
      clip, meter,
      historyDeps: deps.loop.historyDeps,
      onChange: deps.loop.onChange,
      isLinked: deps.loop.isLinked,
      onToggleLink: deps.loop.onToggleLink,
      onClipLoopEdited: deps.loop.onClipLoopEdited,
      tickToX: (t) => (t / total) * contentW(),
      tickFromClientX: (cx) => {
        const x = cx - content.getBoundingClientRect().left;  // shifted by scroll
        return Math.max(0, Math.min(total, (x / Math.max(1, contentW())) * total));
      },
      contentHeight: () => RULER_H + WAVE_H,
    });
  }

  // Transcribe-the-loop controls: a melodic/drums toggle + a button that sends
  // the clip's effective loop region to the audio→notes backend (wired by the
  // router, which binds this clip). Floated to the right of the top row —
  // appended AFTER the loop overlay mounted its own toolbar controls, so the
  // margin-left:auto keeps pushing only this row to the right edge.
  if (deps.transcribe) {
    let kind: 'melodic' | 'drums' = 'melodic';
    let kindBtns: HTMLButtonElement[] = [];
    const paintKind = (): void => {
      for (const b of kindBtns) {
        const on = kind === b.dataset.kind;
        Object.assign(b.style, {
          background: on ? '#4a9a6a' : 'transparent', color: on ? '#000' : '#8a8a90',
          border: on ? '1px solid #4a9a6a' : '1px solid #2c2c32', fontWeight: on ? '700' : '400',
          padding: '3px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
        } as Partial<CSSStyleDeclaration>);
      }
    };
    const tFrag = document.createDocumentFragment();
    render(html`
      <div class="audio-clip-transcribe-row" style="display:flex;gap:4px;align-items:center;margin-left:auto">
        <span style="color:#8a8a90;font-size:10px">TRANSCRIBE</span>
        ${(['melodic', 'drums'] as const).map((k) => html`<button class="transcribe-kind" data-kind=${k}
          @click=${() => { kind = k; paintKind(); }}>${k === 'melodic' ? 'Melodic' : 'Drums'}</button>`)}
        <button class="audio-clip-transcribe"
          style="background:#2a3a4a;color:#cfe;border:1px solid #3a5a7a;font-weight:700;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:10px"
          @click=${(e: Event) => {
            const go = e.currentTarget as HTMLButtonElement;
            go.textContent = 'Transcribing…';
            Promise.resolve(deps.transcribe!.run(kind)).finally(() => { go.textContent = 'Transcribe loop'; });
          }}>Transcribe loop</button>
      </div>`, tFrag);
    const row = tFrag.firstElementChild as HTMLElement;
    kindBtns = Array.from(row.querySelectorAll<HTMLButtonElement>('.transcribe-kind'));
    paintKind();
    toolbar.append(row);
  }

  if (sample?.warpRef && deps.warp) {
    const editorHost = content.children[1] as HTMLDivElement;   // reserved in the scaffold above
    // Markers are ABSOLUTE source-buffer time, same as the waveform header above:
    // use the full buffer duration (not trimEnd-trimStart) so markers line up with
    // the waveform, and pass trimStart as the downbeat (beat 0) for re-seeding.
    const buf = sampleCache.get(sample.sampleId);
    const fullDur = buf?.duration ?? sample.trimEnd ?? 1;
    markerHandle = mountWarpMarkerEditor(editorHost, {
      getMarkers: () => clip.sample?.warpMarkers ?? [],
      durationSec: fullDur,
      downbeatSec: sample.trimStart,
      meter, bpm: deps.warp.bpm, clipBars: clip.lengthBars, barsPerMarker: 4,
      getOnsets: deps.warp.getOnsets, onMarkersChange: deps.warp.onMarkersChange,
      contentWidth: contentW,
    });
  }

  relayout();
  viewport.scrollLeft = axis.scrollLeft;      // restore the clip's shared H scroll
  let lastVpW = viewport.clientWidth;
  return {
    dispose: () => primaryAxis.dispose(),
    redraw: () => {
      // On a panel resize, re-fit the content width (relayout redraws header +
      // markers + loop); otherwise just repaint them. Without this the inner
      // canvases widen on resize but the scroll-range wrapper keeps a stale width.
      const vpw = viewport.clientWidth;
      if (vpw && vpw !== lastVpW) { lastVpW = vpw; primaryAxis.invalidate(); applyAxis(); }
      else { header.redraw(); markerHandle?.redraw(); loopHandle?.redraw(); }
      const f = deps.getPlayheadFrac?.() ?? -1;
      if (f >= 0 && isFollowEnabled()) {
        const target = followScrollTarget(f * contentW(), viewport.clientWidth, contentW(), viewport.scrollLeft);
        if (target != null) viewport.scrollLeft = target;
      }
    },
  };
}
