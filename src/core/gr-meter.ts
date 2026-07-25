// Gain-reduction (GR) meter — the readout that makes a compressor legible.
//
// A compressor is invisible: you set THR/RAT and have to guess whether it is
// doing anything. This bar answers that. Empty = not compressing; the fill
// grows as the reduction deepens, so a glance says "it is working", and the
// value text below reads the dB for anyone who wants the number.
//
// `CompBlock.getReduction()` (and now `ChannelStrip.getCompReduction()`) already
// exposed the reading — nothing was drawing it.
//
// The DOM is a ONE-TIME lit render into a detached fragment; the per-frame loop
// then writes the kept element refs imperatively. A template diff per animation
// frame would be pure waste (same reasoning as knob.ts and level-meter.ts).
//
// LIFECYCLE: each meter owns its own requestAnimationFrame chain (at most a
// couple are ever on screen, so a shared loop like level-meter's buys nothing).
// The caller MUST call dispose() when the widget leaves the screen — an orphaned
// frame loop keeps reading a strip nobody is looking at, forever. A per-container
// cleanup slot is NOT enough for that: a panel that can mount into several
// containers (one per page, like the lane FX panel) has to own the teardown
// across all of them. dispose() parks the bar empty and leaves the element to its
// owner, so it is safe to call on a panel that is still in the DOM.

import { html, render as litRender } from 'lit-html';

/** Reduction (dB, negative) at which the bar reads completely full. */
export const GR_FLOOR_DB = -24;

export interface GrReductionSource {
  /** Current gain reduction in dB: 0 = none, negative = compressing. */
  getCompReduction(): number;
}

export interface GrMeterOpts {
  source: GrReductionSource;
  /** Caption above the bar. Defaults to 'GR'. */
  label?: string;
  /** Native tooltip for the whole widget. */
  title?: string;
}

export interface GrMeterHandle {
  el: HTMLElement;
  /** Reads the source once and repaints. The frame loop calls this; it is public
   *  so tests can drive the meter without a frame clock. No-op once disposed. */
  sample(): void;
  /** Cancels the frame loop and parks the bar empty, leaving the element where
   *  its owner mounted it. Idempotent. */
  dispose(): void;
}

/**
 * Bar fill for a reduction reading, as 0..1. Non-finite readings (a backend
 * that does not implement `DynamicsCompressorNode.reduction`) read as empty
 * rather than painting garbage, and anything past the floor saturates.
 */
export function grFillFraction(db: number): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  const depth = -db;                    // dB of reduction, as a positive number
  if (depth <= 0) return 0;
  return Math.min(1, depth / -GR_FLOOR_DB);
}

const DEFAULT_TITLE =
  'Gain reduction: how much the compressor is turning this lane down right now. '
  + `Empty = not compressing; full = ${-GR_FLOOR_DB} dB or more.`;

export function createGrMeter(opts: GrMeterOpts): GrMeterHandle {
  const frag = document.createDocumentFragment();
  litRender(html`
    <div class="gr-meter" title=${opts.title ?? DEFAULT_TITLE}>
      <div class="gr-meter-label">${opts.label ?? 'GR'}</div>
      <div class="gr-meter-track"><div class="gr-meter-fill"></div></div>
      <div class="gr-meter-value">0.0</div>
    </div>
  `, frag);

  const el     = frag.firstElementChild as HTMLElement;
  const fillEl = el.querySelector('.gr-meter-fill') as HTMLElement;
  const valEl  = el.querySelector('.gr-meter-value') as HTMLElement;
  fillEl.style.height = '0%';

  // Tenths of a percent: enough resolution to look continuous, coarse enough
  // that a steady signal stops touching the DOM.
  let lastTenths = 0;
  let rafId: number | null = null;
  let disposed = false;

  const sample = (): void => {
    // A disposed meter stays parked: the frame loop is already inert, and this
    // entry point is public, so it has to hold the same line.
    if (disposed) return;
    const db = opts.source.getCompReduction();
    const tenths = Math.round(grFillFraction(db) * 1000);
    if (tenths === lastTenths) return;
    lastTenths = tenths;
    fillEl.style.height = `${tenths / 10}%`;
    valEl.textContent = tenths === 0 ? '0.0' : db.toFixed(1);
    el.classList.toggle('active', tenths > 0);
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    // Park the bar EMPTY, and leave the element where its owner put it: the panel
    // interpolates this node through lit and wipes it on its own terms, so
    // detaching it here would only leave a hole the next repaint re-fills. A
    // parked bar must not keep a reduction on screen either — that is the same
    // lie a bypassed compressor would tell (see CompBlock.getReduction).
    lastTenths = 0;
    fillEl.style.height = '0%';
    valEl.textContent = '0.0';
    el.classList.remove('active');
  }

  // Self-parking backstop. The owning panel disposes the meter when it rebuilds,
  // but nothing disposes it on the path where the panel's container is wiped by
  // someone else and the panel never comes back (an engine editor taking over
  // the slot). Once the widget has BEEN on the page and then leaves it, the loop
  // stops itself. Armed only after a first connected frame, so a deliberately
  // detached mount (unit tests, offscreen build) still samples.
  let wasConnected = false;

  const frame = (): void => {
    if (disposed) return;
    if (el.isConnected) wasConnected = true;
    else if (wasConnected) { dispose(); return; }
    sample();
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);

  return { el, sample, dispose };
}
