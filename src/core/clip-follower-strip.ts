// src/core/clip-follower-strip.ts
// A horizontal strip that FOLLOWS a clip's ClipAxis: it lines up with the
// primary editor's grid, is exactly as wide, scrolls with it and shares its
// zoom. Used by the waveform header above a note editor and by every per-clip
// automation lane — the two surfaces that used to invent their own geometry.
//
// Structure:
//
//   root      .clip-follow-row      flex row: [label slot][window]
//     label   .clip-follow-label    optional; the caller fills it
//     window  .clip-follow-window   overflow:hidden, width = primary viewport width
//       content .clip-follow-content  width = axis.contentWidth(), translated by -scrollLeft
//
// The scroll is a transform, not a scroll container: a second scrollbar under
// the editor would be both ugly and a feedback-loop risk (the piano-roll already
// pins its ruler and velocity lane the same way).
//
// The caller puts a canvas (and any overlay, e.g. the loop shade) inside
// `content`, sized to axis.contentWidth(), and redraws on layout().

import { followerGeometry, type ClipAxis } from './clip-axis';
import { renderElement } from './lit-fragment';
import { html } from 'lit-html';

export interface FollowerStripOpts {
  axis: ClipAxis;
  /** Strip height in CSS px (the window clips to it). */
  height: number;
  /** Extra class on the row, for per-surface styling. */
  className?: string;
  /** Called after every geometry change, once the DOM has been laid out, so the
   *  caller can resize + repaint its canvas. */
  onLayout?: (contentWidth: number, height: number) => void;
}

export interface FollowerStrip {
  /** The row. Append this where the strip should appear. */
  root: HTMLElement;
  /** Fixed-width slot to the left of the timeline (aligned with the editor's
   *  key/label gutter). Put the lane name and its buttons here. */
  label: HTMLElement;
  /** The clipping window. Its width tracks the primary viewport. */
  window: HTMLElement;
  /** Timeline-space container: `axis.contentWidth()` wide, translated by the
   *  shared scroll. Canvases and overlays go in here. */
  content: HTMLElement;
  /** Re-measure and re-apply. Safe to call at RAF rate: it writes only when a
   *  value actually changed. */
  layout: () => void;
  dispose: () => void;
}

export function createFollowerStrip(opts: FollowerStripOpts): FollowerStrip {
  const { axis } = opts;

  const root = renderElement<HTMLDivElement>(html`
    <div class=${`clip-follow-row ${opts.className ?? ''}`.trim()}>
      <div class="clip-follow-label"></div>
      <div class="clip-follow-window">
        <div class="clip-follow-content"></div>
      </div>
    </div>
  `);
  const label = root.querySelector('.clip-follow-label') as HTMLElement;
  const win = root.querySelector('.clip-follow-window') as HTMLElement;
  const content = root.querySelector('.clip-follow-content') as HTMLElement;

  win.style.height = `${opts.height}px`;
  content.style.height = `${opts.height}px`;

  // Last applied values: every write is guarded so a RAF-rate layout() costs a
  // few comparisons instead of a forced style recalc per frame.
  let lastLeft = NaN, lastWidth = NaN, lastContentW = NaN, lastScroll = NaN;

  const layout = (): void => {
    const vp = axis.primaryViewport;
    // The label slot must reserve exactly the editor's gutter: measure the gap
    // between the row and the primary viewport instead of hardcoding 42px /
    // LABEL_W / 0 per editor.
    const geo = followerGeometry(
      root.getBoundingClientRect(),
      vp ? vp.getBoundingClientRect() : { left: 0, width: 0 },
    );
    if (geo.marginLeft !== lastLeft) {
      lastLeft = geo.marginLeft;
      label.style.flex = `0 0 ${geo.marginLeft}px`;
    }
    if (geo.width !== lastWidth) {
      lastWidth = geo.width;
      win.style.width = `${geo.width}px`;
    }
    const cw = axis.contentWidth();
    if (cw !== lastContentW) {
      lastContentW = cw;
      content.style.width = `${cw}px`;
      opts.onLayout?.(cw, opts.height);
    }
    const scroll = axis.scrollLeft;
    if (scroll !== lastScroll) {
      lastScroll = scroll;
      content.style.transform = `translateX(${-scroll}px)`;
    }
  };

  const off = axis.subscribe(() => layout());
  // The row's own width changes with the panel (window resize, inspector
  // reflow) without the axis moving at all, and that changes the measured
  // gutter — so watch the row too.
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layout()) : null;
  ro?.observe(root);
  layout();

  return {
    root, label, window: win, content,
    layout,
    dispose: () => { off(); ro?.disconnect(); },
  };
}
