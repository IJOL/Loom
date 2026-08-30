// src/performance/performance-ui-templates.ts
// lit-html templates for the Performance view: toolbar, ruler (+ loop brace),
// per-lane clip bands and the empty state. Extracted from performance-ui.ts so
// the view module keeps the mount/zoom lifecycle and this one keeps the markup.
//
// Drag interactions (loop brace, clip move/resize) stay imperative against a
// rect captured at pointerdown, committing once on pointerup — committing
// mid-drag would re-render the view and detach the very element being dragged.
// On pointerup each drag RESTORES the element's pre-drag geometry before the
// commit callback: lit diffs a style binding against its last committed value,
// so a commit that clamps/snaps back to the same numbers would skip the DOM
// write and leave the drag offset behind.

import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { ArrangementState, ArrangementLaneRec, ArrangementClipEvent } from './performance';
import type { PerfUICallbacks } from './performance-ui';
import { effectiveDurationSec } from './arrangement-ops';
import { pxToBar, clampBarRegion } from './arrangement-brace';
import { songBarSec } from '../core/song-position';

export function labelTemplate(text: string): TemplateResult {
  return html`<div class="perf-label">${text}</div>`;
}

// ── Toolbar ────────────────────────────────────────────────────────────────

export function toolbarTemplate(state: ArrangementState, cb: PerfUICallbacks): TemplateResult {
  // Show the length the timeline ACTUALLY has, not the raw `lengthBars`.
  // `lengthBars` is the user's explicit MINIMUM (0 = auto//derive-from-content),
  // so the field read "0 bars" over 8 bars of copied content. Typing still sets an
  // explicit minimum; it just can't shrink the field below the real content.
  const bars = Math.ceil(effectiveDurationSec(state, cb.meter) / songBarSec(state.bpm, cb.meter));

  // Editable A/B bar fields — dragging the brace on a long song is a pain. Typing
  // a value sets AND enables the loop (the button still toggles it off).
  const commitLoop = (e: Event) => {
    const [aIn, bIn] = (e.currentTarget as HTMLElement).closest('.perf-loop-fields')!.querySelectorAll('input');
    const a = Math.max(0, Math.floor(parseFloat(aIn.value) || 0));
    const b = Math.max(a + 1, Math.floor(parseFloat(bIn.value) || a + 1));
    cb.onSetLoop(true, a, b);
  };

  // live(): these inputs are user-editable, so diff against the DOM value, not
  // lit's last committed one — a commit that lands on the same canonical string
  // must still overwrite whatever the user typed.
  return html`<div class="perf-toolbar"><label class="perf-length">Length: <input
        type="number"
        min="1"
        class="perf-length-input"
        .value=${live(String(bars))}
        @change=${(e: Event) => cb.onSetLengthBars(parseInt((e.currentTarget as HTMLInputElement).value, 10) || 0)}
      > bars</label> · Zoom <input
        type="range"
        min="16"
        max="400"
        step="1"
        class="perf-zoom"
        .value=${live(String(cb.pxPerBar))}
        @change=${(e: Event) => cb.onZoom(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
      > · <button
        class=${'rnd perf-loop-toggle' + (cb.loopEnabled ? ' primary' : '')}
        @click=${() => cb.onSetLoop(!cb.loopEnabled, cb.loopStartBar, cb.loopEndBar)}
      >Loop A–B</button><span class="perf-loop-fields">A<input
        type="number"
        min="0"
        class="perf-loop-input"
        title="Loop start (bar)"
        .value=${live(String(cb.loopStartBar))}
        @change=${commitLoop}
      >B<input
        type="number"
        min="0"
        class="perf-loop-input"
        title="Loop end (bar)"
        .value=${live(String(cb.loopEndBar))}
        @change=${commitLoop}
      ></span> · <span class="perf-readout">${bars} bars · ${state.bpm} BPM</span>${cb.buildMaster?.() ?? nothing}</div>`;
}

// ── Empty state ────────────────────────────────────────────────────────────

export function emptyTemplate(cb: PerfUICallbacks): TemplateResult {
  // The primary gesture IS the interface: an empty song invites loops. The
  // whole empty state is a live drop target (attachPerfDrop listens on the
  // host); the record button ships disabled until the capture round.
  return html`<div class="perf-empty"><div class="perf-empty-drop perf-dropzone">
        <p class="perf-empty-big">Drop audio loops to start</p>
        <p>each loop becomes a lane, fitted to the session tempo</p>
        <p class="perf-empty-rec"><button disabled title="Record a loop — coming in the capture round">● Record a loop</button></p>
      </div>
      <p>…or arm <b>REC</b>, go back to Session, launch clips and move knobs.</p>
      <button class="perf-empty-back" @click=${cb.onGoToSession}>Back to Session</button></div>`;
}

// ── Ruler + loop brace ─────────────────────────────────────────────────────

// The row templates take the already-computed `barSec` rather than a bpm: the
// view resolves it ONCE — from the arrangement's bpm and the SONG's meter, which
// reaches it as `cb.meter` from the Sequencer that owns it (an arrangement
// carries no meter; see performance.ts) — and hands the same number to the
// ruler, the bands and the lane widths, so nothing downstream can quietly
// re-derive a bar of its own.
export function rulerTemplate(durationSec: number, barSec: number, pxPerBar: number, cb: PerfUICallbacks): TemplateResult {
  const bars = Math.ceil(durationSec / barSec);
  // Click = seek; drag on empty ruler space = set the A–B loop. The drag only
  // engages past a small threshold, and once it has, the trailing click is
  // suppressed so a loop-set never doubles as a seek.
  let dragged = false;
  const onClick = (e: MouseEvent) => {
    if (dragged) { dragged = false; return; }
    if ((e.target as HTMLElement).closest('.perf-loop-brace')) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    cb.onSeek?.(((e.clientX - rect.left) / pxPerBar) * barSec);
  };
  const onDown = (down: PointerEvent) => {
    if ((down.target as HTMLElement).closest('.perf-loop-brace')) return;
    const track = down.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const startBar = pxToBar(down.clientX - rect.left, pxPerBar);
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - down.clientX) < 4 && !dragged) return;
      dragged = true;
      const b = pxToBar(e.clientX - rect.left, pxPerBar);
      const region = clampBarRegion(Math.min(startBar, b), Math.max(startBar, b), bars);
      if (region.end > region.start) cb.onSetLoop(true, region.start, region.end);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return html`<div class="perf-row perf-ruler">${labelTemplate('bars')}<div
      class="perf-track"
      style="width:${bars * pxPerBar}px"
      @click=${onClick}
      @pointerdown=${onDown}
    >${Array.from({ length: bars }, (_, b) => html`<span
      class="perf-bar-mark"
      style="left:${b * pxPerBar}px"
    >${b + 1}</span>`)}${cb.loopEnabled ? loopBraceTemplate(pxPerBar, bars, cb) : nothing}</div></div>`;
}

function loopBraceTemplate(pxPerBar: number, bars: number, cb: PerfUICallbacks): TemplateResult {
  const drag = (which: 'l' | 'r') => (down: PointerEvent) => {
    down.preventDefault();
    const brace = (down.currentTarget as HTMLElement).parentElement as HTMLElement;
    const track = brace.parentElement as HTMLElement;
    const rect = track.getBoundingClientRect();
    const base = { left: brace.style.left, width: brace.style.width };
    let region = { start: cb.loopStartBar, end: cb.loopEndBar };
    const move = (e: PointerEvent) => {
      const b = pxToBar(e.clientX - rect.left, pxPerBar);
      region = which === 'l' ? clampBarRegion(b, cb.loopEndBar, bars) : clampBarRegion(cb.loopStartBar, b, bars);
      brace.style.left = `${region.start * pxPerBar}px`;
      brace.style.width = `${(region.end - region.start) * pxPerBar}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      brace.style.left = base.left; brace.style.width = base.width; // see header comment
      cb.onSetLoop(true, region.start, region.end);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return html`<div
    class="perf-loop-brace"
    style="left:${cb.loopStartBar * pxPerBar}px;width:${(cb.loopEndBar - cb.loopStartBar) * pxPerBar}px"
  ><span class="perf-loop-handle l" @pointerdown=${drag('l')}></span><span class="perf-loop-handle r" @pointerdown=${drag('r')}></span></div>`;
}

// ── Clip bands ─────────────────────────────────────────────────────────────

export function clipBandTemplate(
  laneRec: ArrangementLaneRec,
  durationSec: number,
  barSec: number,
  pxPerBar: number,
  cb: PerfUICallbacks,
): TemplateResult {
  const totalBars = Math.ceil(durationSec / barSec);
  const secPerPx = barSec / pxPerBar; // inverse of the draw scale
  // Lane header: name + (optional) mute/solo + VU, mirroring the session mixer.
  // Loop A–B span across this lane: a translucent column with A/B edges. Every
  // lane draws it at the same x (same pxPerBar), so it reads as one continuous
  // marker down the whole arrangement, not just a brace in the ruler.
  return html`<div class="perf-row" data-lane-id=${laneRec.laneId}><div class="perf-label"><span
      class="perf-lane-name"
    >${laneRec.laneId}</span>${cb.buildLaneHeader?.(laneRec.laneId) ?? nothing}</div><div
      class="perf-track"
      style="width:${totalBars * pxPerBar}px"
    ><div class="perf-clip-band">${laneRec.clipEvents.map((ev, i) =>
      clipTemplate(laneRec.laneId, ev, i, durationSec, barSec, secPerPx, pxPerBar, cb),
    )}</div>${cb.loopEnabled && cb.loopEndBar > cb.loopStartBar ? html`<div
      class="perf-loop-span"
      style="left:${cb.loopStartBar * pxPerBar}px;width:${(cb.loopEndBar - cb.loopStartBar) * pxPerBar}px"
    ></div>` : nothing}</div></div>`;
}

function clipTemplate(
  laneId: string,
  ev: ArrangementClipEvent,
  i: number,
  durationSec: number,
  barSec: number,
  secPerPx: number,
  pxPerBar: number,
  cb: PerfUICallbacks,
): TemplateResult {
  const x = (ev.atSec / barSec) * pxPerBar;
  const w = (Math.min(ev.untilSec, durationSec) - ev.atSec) / barSec * pxPerBar;
  const color = cb.resolveClipColor(ev.clipId);
  const baseLeft = `${x}px`;
  const baseWidth = `${Math.max(8, w)}px`;

  // Body drag moved to the gesture layer (perf-gestures.ts): selection,
  // marquee, free-move+clamp, Shift-ripple, Alt-nosnap, cross-lane. Only the
  // edge handles and the × keep per-element handlers (they stopPropagation, so
  // the layer never sees them).
  void secPerPx;
  const resize = (edge: 'start' | 'end') => (down: PointerEvent) => {
    down.preventDefault(); down.stopPropagation();
    const el = (down.currentTarget as HTMLElement).parentElement as HTMLElement; // the .perf-clip
    const track = el.closest('.perf-track') as HTMLElement;
    const move = (e: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      const sec = ((e.clientX - rect.left) / pxPerBar) * barSec;
      if (edge === 'start') el.style.left = `${(sec / barSec) * pxPerBar}px`;
      else el.style.width = `${Math.max(8, (sec - ev.atSec) / barSec * pxPerBar)}px`;
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const rect = track.getBoundingClientRect();
      const sec = ((e.clientX - rect.left) / pxPerBar) * barSec;
      el.style.left = baseLeft; el.style.width = baseWidth; // see header comment
      cb.onResizeBand(laneId, i, edge, sec);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // What the band shows: a waveform for an audio clip, a note preview for a
  // MIDI one (painted by performance-ui's paintBandCanvases pass after the lit
  // commit), loop ticks where the band tiles past one clip iteration, and the
  // bars-chip on audio bands. Muted paints dimmed; selection paints an outline.
  const info = cb.resolveClipInfo?.(ev.clipId) ?? null;
  const durSec = Math.min(ev.untilSec, durationSec) - ev.atSec;
  const loops = info && info.loopSec > 0 ? Math.floor(durSec / info.loopSec + 1e-9) : 0;
  const ticks = Math.max(0, Math.min(64, loops - 1));
  const classes = ['perf-clip'];
  if (!color) classes.push('missing');
  if (ev.muted) classes.push('muted');
  if (cb.selection?.has(ev.id)) classes.push('selected');
  return html`<div
    class=${classes.join(' ')}
    data-band-id=${ev.id}
    style="left:${baseLeft};width:${baseWidth}${color ? `;background:${color}` : ''}"
  >${info ? html`<canvas
      class="perf-clip-canvas"
      data-clip-id=${ev.clipId}
      data-w=${Math.max(8, w)}
      data-offset-sec=${ev.offsetSec ?? 0}
      data-dur-sec=${durSec}
    ></canvas>` : nothing}<span class="perf-clip-name">${cb.resolveClipName(ev.clipId)}</span>${Array.from(
      { length: ticks },
      (_, t) => html`<span
        class="perf-clip-looptick"
        style="left:${((t + 1) * info!.loopSec / barSec) * pxPerBar}px"
      ></span>`,
    )}${info?.kind === 'audio' ? html`<span class="perf-clip-bars">${Math.round(info.loopSec / barSec) || 1} bar${Math.round(info.loopSec / barSec) > 1 ? 's' : ''}</span>` : nothing}<span
      class="perf-clip-handle l"
      @pointerdown=${resize('start')}
    ></span><span
      class="perf-clip-handle r"
      @pointerdown=${resize('end')}
    ></span><button
      class="perf-clip-del"
      @pointerdown=${(e: Event) => { e.stopPropagation(); }}
      @click=${(e: Event) => { e.stopPropagation(); cb.onDeleteBand(laneId, i); }}
    >×</button></div>`;
}
