// src/core/clip-axis.ts
// THE horizontal time axis of a clip. One instance per clip id, shared by every
// view that draws that clip's timeline: the piano-roll, the drum grid, the
// waveform header, the audio editor and the per-clip automation lanes.
//
// Why this exists: the same axis used to be implemented four times over, each
// copy owning its own zoom/scroll state and its own px-per-tick maths
// (viewStateByClip in the clip-editor router, hViewByClip in the drum grid,
// audioHViewByClip in the waveform header, and a fixed max(800, bars*240) canvas
// in the automation lanes). The copies drifted: grids of the same bar came out
// different widths, automation could not zoom with the clip at all, and the loop
// region was missing from the one view that had no axis. One owner, no drift.
//
// Roles:
//   - PRIMARY  — the mounted note/audio editor. It publishes its viewport width
//                (setBasisWidth), owns the scroll gesture and drives zoom.
//   - FOLLOWER — waveform header, automation lanes. They never zoom on their own:
//                they size their canvas to contentWidth() and mirror scrollLeft,
//                and align to the primary's viewport rect via followerGeometry().
//
// Vertical (pitch rows, row height, scrollTop) stays local to each editor — this
// is only the time axis. The maths is reused from pianoroll-zoom.ts, never
// reimplemented.

import { clampZoom, maxZoomX, scrubToZoom, zoomAroundAnchor } from './pianoroll-zoom';

export type ClipAxisListener = (axis: ClipAxis) => void;

export class ClipAxis {
  private _total: number;
  private _basis = 0;
  private _zoom = 1;
  private _scroll = 0;
  private _vp: HTMLElement | null = null;
  private listeners = new Set<ClipAxisListener>();

  constructor(readonly clipId: string, totalTicks: number) {
    this._total = Math.max(0, totalTicks);
  }

  get totalTicks(): number { return this._total; }
  get basisWidth(): number { return this._basis; }
  get zoomX(): number { return this._zoom; }
  get scrollLeft(): number { return this._scroll; }

  /** Width (CSS px) the whole clip occupies at zoom 1 — i.e. the PRIMARY editor's
   *  viewport width. Only the primary calls this. */
  setBasisWidth(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (next === this._basis) return;
    this._basis = next;
    this.reclamp();
    this.emit();
  }

  /** Clip length changed (length field, tempo *2 · /2, a MIDI re-import). */
  setTotalTicks(ticks: number): void {
    const next = Math.max(0, ticks);
    if (next === this._total) return;
    this._total = next;
    this.emit();
  }

  setZoom(zoom: number): void {
    const next = clampZoom(zoom, maxZoomX(this._basis));
    if (next === this._zoom) return;
    this._zoom = next;
    this.reclamp();
    this.emit();
  }

  setScrollLeft(px: number): void {
    const next = this.clampScroll(px);
    if (next === this._scroll) return;
    this._scroll = next;
    this.emit();
  }

  /** Zoom by a vertical scrub (the ruler/strip gesture every editor already has),
   *  keeping the tick under `anchorPx` (viewport-relative x) stationary. */
  scrub(dyPx: number, anchorPx: number): void {
    const oldW = this.contentWidth();
    const zoom = clampZoom(scrubToZoom(this._zoom, dyPx), maxZoomX(this._basis));
    if (zoom === this._zoom) return;
    this._zoom = zoom;
    this._scroll = this.clampScroll(zoomAroundAnchor(this._scroll, anchorPx, oldW, this.contentWidth()));
    this.emit();
  }

  /** Px the whole clip spans at the current zoom. 0 before the primary has laid
   *  out — callers guard on pxPerTick() > 0 the same way they always did. */
  contentWidth(): number {
    return Math.round(this._basis * this._zoom);
  }

  pxPerTick(): number {
    return this._total > 0 ? this.contentWidth() / this._total : 0;
  }

  /** Content-space x (px from the clip's tick 0), NOT viewport-space. */
  tickToX(tick: number): number {
    return tick * this.pxPerTick();
  }

  /** Inverse of tickToX, clamped to the clip. */
  tickFromContentX(x: number): number {
    const per = this.pxPerTick();
    if (per <= 0) return 0;
    return Math.max(0, Math.min(this._total, x / per));
  }

  /** The PRIMARY editor's scrolling viewport. Followers measure their alignment
   *  against its rect (followerGeometry), so they need no knowledge of which
   *  editor is mounted or what gutter it has. Registered by the primary on
   *  mount, cleared on dispose. */
  setPrimaryViewport(el: HTMLElement | null): void {
    if (el === this._vp) return;
    this._vp = el;
    this.emit();
  }

  get primaryViewport(): HTMLElement | null { return this._vp; }

  subscribe(cb: ClipAxisListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private clampScroll(px: number): number {
    const max = Math.max(0, this.contentWidth() - this._basis);
    return Math.max(0, Math.min(max, Math.round(px)));
  }

  /** Basis or zoom moved: the zoom ceiling and the scroll range both depend on it. */
  private reclamp(): void {
    this._zoom = clampZoom(this._zoom, maxZoomX(this._basis));
    this._scroll = this.clampScroll(this._scroll);
  }

  private emit(): void {
    // Snapshot: a listener may re-render and (un)subscribe while we iterate.
    for (const cb of [...this.listeners]) cb(this);
  }
}

// ── Per-clip registry ──────────────────────────────────────────────────────
// In-memory only, exactly like the three view-state maps it replaces: zoom is a
// session-lifetime convenience, never persisted (no save-schema change).

const axes = new Map<string, ClipAxis>();

/** The axis for `clipId`, created fitted on first use. Passing `totalTicks`
 *  refreshes the length, so callers can always hand over the clip's current
 *  bars without a separate "did it grow?" check. */
export function clipAxis(clipId: string, totalTicks: number): ClipAxis {
  const existing = axes.get(clipId);
  if (existing) {
    existing.setTotalTicks(totalTicks);
    return existing;
  }
  const created = new ClipAxis(clipId, totalTicks);
  axes.set(clipId, created);
  return created;
}

/** Forget a clip's axis (clip deleted, or a deliberate "reset the view"). */
export function releaseClipAxis(clipId: string): void {
  axes.delete(clipId);
}

/** @internal test hook — the registry is module state. */
export function _resetClipAxesForTesting(): void {
  axes.clear();
}

// ── Follower alignment ─────────────────────────────────────────────────────

export interface RectLike { left: number; width: number }

/** Where a follower strip must sit inside its own host so its tick 0 lands
 *  exactly on the primary viewport's tick 0, and its visible window is exactly
 *  as wide.
 *
 *  Measured, not computed: taking the primary viewport's real rect means the
 *  follower needs to know nothing about which gutter that editor has (42px of
 *  piano keys, the drum grid's label column, or none at all for audio), nor
 *  about its 1px border or its reserved scrollbar gutter. Duplicating those
 *  constants is exactly the drift this module exists to kill. */
export function followerGeometry(hostRect: RectLike, primaryVpRect: RectLike): { marginLeft: number; width: number } {
  // Pre-layout (jsdom, or a panel rendered while hidden) every rect is zero;
  // fall back to the host's own width so the follower stays visible.
  if (primaryVpRect.width <= 0) return { marginLeft: 0, width: Math.round(Math.max(0, hostRect.width)) };
  return {
    marginLeft: Math.max(0, Math.round(primaryVpRect.left - hostRect.left)),
    width: Math.round(primaryVpRect.width),
  };
}
