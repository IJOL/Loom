// src/session/clip-auto-strip.ts
// One automation lane's drawing surface, mounted as a ClipAxis FOLLOWER: it
// starts where the editor's grid starts, is exactly as wide, scrolls with it,
// zooms with it, shows the clip's loop region and draws the clip's playhead.
//
// Before this existed the lane was a bare canvas of `max(800, bars * 240)` px:
// its own private geometry, no zoom, no loop, and a cursor driven by a global
// sub-step counter. Everything horizontal now comes from the shared axis.
//
// The loop region is display-only (pointer-events: none in _clip-follow.scss):
// a draggable region would swallow the paint gesture, which is what the lane is
// for. The loop itself is edited in the editor above, whose overlay already
// owns that interaction.

import { html } from 'lit-html';
import type { SessionClip, ClipEnvelope } from './session';
import { stepsPerBar, stepsPerBeat, ticksPerBar, type TimeSignature } from '../core/meter';
import { effectiveClipLoop } from '../core/clip-loop';
import { createFollowerStrip } from '../core/clip-follower-strip';
import type { ClipAxis } from '../core/clip-axis';
import { renderElement } from '../core/lit-fragment';
import {
  drawLane, attachLanePainter, ensureLaneSize, type AutoBrush,
} from '../automation/automation-painter';

/** Lane height in CSS px. */
export const AUTO_LANE_H = 80;

export interface AutoStripOpts {
  axis: ClipAxis;
  clip: SessionClip;
  meter: TimeSignature;
  env: ClipEnvelope;
  getBrush: () => AutoBrush;
  /** Playhead as a 0..1 fraction of the clip; negative when idle. */
  getPlayheadFrac: () => number;
}

export interface AutoStrip {
  /** The follower row — append this where the lane should appear. */
  root: HTMLElement;
  /** Gutter slot, already the width of the editor's key/label column. */
  label: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Repaint the curve (after an external edit — e.g. the LFO generator). */
  draw: () => void;
  /** Cheap per-frame tick: re-measures the follower geometry and repaints only
   *  when the playhead actually moved. Safe at RAF rate. */
  tick: () => void;
  dispose: () => void;
}

export function createAutoStrip(o: AutoStripOpts): AutoStrip {
  const canvas = renderElement<HTMLCanvasElement>(html`<canvas class="auto-lane-canvas"></canvas>`);
  const loopShade = renderElement<HTMLDivElement>(html`<div class="clip-follow-loop"></div>`);

  // Stable painter view over the envelope: same .values ARRAY REFERENCE as
  // env.values (the live audio path reads that array), never a copy.
  const painterLane = {
    values: o.env.values,
    enabled: o.env.enabled !== false,
    stepped: !!o.env.stepped,
    lengthBars: o.clip.lengthBars,
  };

  let lastFrac = Number.NaN;
  let lastLoopSig = '';

  /** Identity of the loop region as drawn. The loop is edited in the EDITOR
   *  above (its overlay owns that gesture) and nothing notifies this lane, so
   *  the tick compares instead of subscribing: three numbers per frame, and it
   *  cannot go stale the way a missed notification would. */
  function loopSig(): string {
    if (!o.clip.loopEnabled) return 'off';
    const { startTick, endTick } = effectiveClipLoop(o.clip, o.meter);
    return `${startTick}:${endTick}`;
  }

  // Declared before the strip: createFollowerStrip lays out (and therefore calls
  // onLayout) during construction.
  function sizeCanvas(contentWidth: number): void {
    const w = Math.max(1, Math.round(contentWidth));
    canvas.width = w;
    canvas.height = AUTO_LANE_H;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${AUTO_LANE_H}px`;
  }

  function layoutLoop(): void {
    lastLoopSig = loopSig();
    const on = !!o.clip.loopEnabled;
    loopShade.style.display = on ? '' : 'none';
    if (!on) return;
    const { startTick, endTick } = effectiveClipLoop(o.clip, o.meter);
    const x0 = o.axis.tickToX(startTick);
    const x1 = o.axis.tickToX(endTick);
    loopShade.style.left = `${x0}px`;
    loopShade.style.width = `${Math.max(0, x1 - x0)}px`;
  }

  function draw(): void {
    // The envelope must cover the clip before it is drawn or painted: a length
    // edit (or a *2 / /2 tempo scale) changes how many sub-steps a bar needs.
    ensureLaneSize(painterLane, o.clip.lengthBars * 16);
    painterLane.enabled = o.env.enabled !== false;
    painterLane.stepped = !!o.env.stepped;
    lastFrac = o.getPlayheadFrac();
    drawLane(canvas, painterLane, {
      stepsPerBar: stepsPerBar(o.meter),
      stepsPerBeat: stepsPerBeat(o.meter),
      playheadFrac: lastFrac,
    });
    layoutLoop();
  }

  const strip = createFollowerStrip({
    axis: o.axis,
    height: AUTO_LANE_H,
    className: 'clip-auto-strip',
    onLayout: (contentWidth) => { sizeCanvas(contentWidth); draw(); },
  });
  strip.content.append(canvas, loopShade);
  sizeCanvas(Math.max(1, o.axis.contentWidth()));
  draw();

  attachLanePainter(canvas, painterLane, draw, o.getBrush);

  return {
    root: strip.root,
    label: strip.label,
    canvas,
    draw,
    tick: () => {
      strip.layout();
      // The loop moved in the editor above: re-place the shade only (the curve
      // itself did not change, so no canvas repaint).
      if (loopSig() !== lastLoopSig) layoutLoop();
      const frac = o.getPlayheadFrac();
      // Repaint only when the cursor moved (or when it just went idle), so an
      // idle inspector costs nothing per frame.
      if (frac !== lastFrac) draw();
    },
    dispose: () => strip.dispose(),
  };
}

/** Total ticks of a clip — the axis length a strip expects. Kept here so the
 *  panel and the strip agree without either importing the other's maths. */
export function clipTotalTicks(clip: SessionClip, meter: TimeSignature): number {
  return Math.max(1, clip.lengthBars * ticksPerBar(meter));
}
