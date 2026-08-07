// A loop ring: how far the loop under it has come, and how much is left before
// a queued switch lands.
//
// It is the master strip's scene ring aimed at ONE loop — literally the same
// wedge geometry and the same class names, so the two cannot drift into looking
// like different instruments. Two things are deliberately missing compared to
// that widget: it computes nothing (the caller hands it a reading the host
// already derived) and it owns no clock (the caller calls `set` from a frame
// loop it already has). Both exist so a panel can animate everything it shows
// from a single rAF.

import type { PanelLoopPhase } from '@loom/plugin-sdk';
import { wedgePath } from '../scene-ring';

export interface LoopRingHandle {
  el: HTMLElement;
  set(phase: PanelLoopPhase): void;
}

const STATES = ['silent', 'idle', 'armed', 'imminent'];
const svg = (tag: string) => document.createElementNS('http://www.w3.org/2000/svg', tag);

export function createLoopRing(opts: { label?: string } = {}): LoopRingHandle {
  const el = document.createElement('div');
  // `scene-ring` first: every colour and every state rule already lives there,
  // and `loop-ring` only resizes it for a lane row.
  el.className = 'scene-ring loop-ring silent';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', opts.label ?? 'Loop position');

  const s = svg('svg');
  // The viewBox stays at the scene ring's own 32 units so wedgePath's geometry
  // transfers unchanged; the rendered size is a lane-row decision, not a
  // geometric one.
  s.setAttribute('viewBox', '0 0 32 32');
  s.setAttribute('aria-hidden', 'true');

  const track = svg('circle');
  track.setAttribute('class', 'ring-track');
  track.setAttribute('cx', '16');
  track.setAttribute('cy', '16');
  track.setAttribute('r', '12');

  const wedge = svg('path');
  wedge.setAttribute('class', 'ring-wedge');
  wedge.setAttribute('d', '');

  const num = svg('text');
  num.setAttribute('class', 'ring-num');
  num.setAttribute('x', '16');
  num.setAttribute('y', '16.5');

  s.append(track, wedge, num);
  el.appendChild(s);

  // Every value is diffed before it is written. A ring is repainted sixty times
  // a second per lane, and an unconditional setAttribute on each of them is
  // enough style invalidation to be visible in a profile.
  let lastD = '';
  let lastState = 'silent';
  let lastText = '';

  return {
    el,
    set(phase) {
      const d = phase.state === 'silent' ? '' : wedgePath(phase.frac);
      if (d !== lastD) { wedge.setAttribute('d', d); lastD = d; }

      if (phase.state !== lastState) {
        el.classList.remove(...STATES);
        el.classList.add(phase.state);
        lastState = phase.state;
      }

      const text = phase.state === 'silent' ? '' : phase.centerText;
      if (text !== lastText) { num.textContent = text; lastText = text; }
    },
  };
}
