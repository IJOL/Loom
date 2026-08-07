// Scene countdown ring — the swept sector in the master strip.
//
// Shows how much of the playing scene is left before a queued switch lands
// (amber, draining; red inside the last bar), and sweeps the scene's own loop
// in grey when nothing is queued.
//
// Structurally a sibling of level-meter.ts: a one-shot lit render, then a
// SHARED RAF loop that mutates the kept SVG refs imperatively — per-frame work
// never goes through a template diff. The loop starts lazily with the first
// ring and stops when the last one is disposed.
//
// Every value comes from sceneCountdown (pure); this file only draws.

import { html } from 'lit-html';
import { renderElement } from './lit-fragment';
import { sceneCountdown } from './scene-countdown';
import type { LanePlayState } from '../session/session-runtime';
import type { TimeSignature } from './meter';

const CX = 20, CY = 20, R = 15;

export interface SceneRingDeps {
  /** Getters, never values: the ring outlives many play-state changes and must
   *  not pin a stale map. */
  laneStates(): Map<string, LanePlayState>;
  now(): number;
  bpm(): number;
  meter(): TimeSignature;
  /** One line under the ring: the active scene when idle, `→ target` when a
   *  switch is pending. The host owns the wording. */
  caption(): string;
}

export interface SceneRingHandle {
  el: HTMLElement;
  dispose(): void;
  /** Paint once from the current deps. The RAF loop calls this; tests call it
   *  directly so the widget needs no faked animation frames. */
  refresh(): void;
}

/** SVG path for a pie wedge covering `frac` of the circle, clockwise from 12
 *  o'clock. Exported for its own tests: 0 and 1 are where an arc degenerates. */
export function wedgePath(frac: number): string {
  if (frac <= 0) return '';
  const a = Math.min(frac, 0.9999) * Math.PI * 2 - Math.PI / 2;
  const x = CX + R * Math.cos(a);
  const y = CY + R * Math.sin(a);
  const large = frac > 0.5 ? 1 : 0;
  return `M ${CX} ${CY} L ${CX} ${CY - R} A ${R} ${R} 0 ${large} 1 ${x} ${y} Z`;
}

// ── Shared RAF loop ────────────────────────────────────────────────────────

const rings = new Set<SceneRingHandle>();
let rafId: number | null = null;

function tick(): void {
  for (const r of rings) r.refresh();
  rafId = rings.size > 0 ? requestAnimationFrame(tick) : null;
}

export function createSceneRing(deps: SceneRingDeps): SceneRingHandle {
  const el = renderElement(html`
    <div class="scene-ring" role="img" aria-label="Time left in the scene">
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle class="ring-track" cx=${CX} cy=${CY} r=${R}></circle>
        <path class="ring-wedge" d=""></path>
        <circle class="ring-hairline" cx=${CX} cy=${CY} r=${R}></circle>
        <text class="ring-num" x=${CX} y=${CY + 0.5}></text>
      </svg>
      <div class="ring-caption"></div>
    </div>
  `);

  const wedge = el.querySelector('.ring-wedge') as SVGPathElement;
  const num = el.querySelector('.ring-num') as SVGTextElement;
  const cap = el.querySelector('.ring-caption') as HTMLElement;

  let live = true;
  let lastD = '';
  let lastState = '';

  const handle: SceneRingHandle = {
    el,
    refresh() {
      if (!live) return;
      const c = sceneCountdown(deps.laneStates(), deps.now(), deps.bpm(), deps.meter());
      const d = wedgePath(c.state === 'silent' ? 0 : c.frac);
      if (d !== lastD) { wedge.setAttribute('d', d); lastD = d; }
      if (c.state !== lastState) {
        el.classList.remove('idle', 'armed', 'imminent', 'silent');
        el.classList.add(c.state);
        lastState = c.state;
      }
      num.textContent = c.centerText;
      cap.textContent = c.state === 'silent' ? '' : deps.caption();
    },
    dispose() {
      live = false;
      rings.delete(handle);
      if (rings.size === 0 && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };

  rings.add(handle);
  if (rafId === null) rafId = requestAnimationFrame(tick);
  handle.refresh();
  return handle;
}
