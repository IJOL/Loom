// The VU meter's COLUMN — the fourteen segments and the peak that hangs above
// them — with no idea where its number comes from.
//
// Split out of level-meter.ts, which reads an AnalyserNode on a shared frame
// loop. That is the right shape for the mixer, where the host owns both the
// audio node and the element. It is the wrong shape for a PANEL: a plugin is
// compiled separately and must never be handed a Web Audio node, so the only
// way a panel could show a meter was to draw a second one — and two VU meters
// with two ideas of what −12 dB looks like is worse than none.
//
// So the column moves here and takes a NUMBER, and the two callers differ only
// in where the number comes from: the mixer reads an analyser every frame, the
// panel asks the host for a lane's level in the frame loop it already runs.
//
// Pure DOM: no AudioContext, no module state, no timer of its own.

import { html, render as litRender } from 'lit-html';
import { SEGMENT_ZONES, litCountForDb } from '../level-meter';

export interface MeterColumnHandle {
  el: HTMLElement;
  /** Show this level. `now` is a timestamp in ms — the caller's frame time —
   *  because the peak hold is a duration and this keeps no clock of its own. */
  set(dbfs: number, now: number): void;
}

/** How long the peak marker hangs before it starts falling, and how fast it
 *  falls once it does. Milliseconds; the values the mixer's meter has always
 *  used, moved here with the code that reads them. */
const PEAK_HOLD_MS = 1500;
const PEAK_DECAY_MS = 120;

export function createMeterColumn(): MeterColumnHandle {
  // Built bottom-first; `flex-direction: column-reverse` in the stylesheet puts
  // index 0 at the bottom, so segments[0] is the quietest LED.
  const frag = document.createDocumentFragment();
  litRender(html`
    <div class="mix-vu-host">
      <div class="mix-vu">
        ${SEGMENT_ZONES.map((zone) => html`<div class="mix-vu-seg mix-vu-seg--${zone}"></div>`)}
      </div>
    </div>
  `, frag);
  const el = frag.firstElementChild as HTMLElement;
  const segments = [...el.querySelectorAll<HTMLDivElement>('.mix-vu-seg')];

  let lastLitCount = 0;
  let peakIdx = -1;
  let heldUntil = 0;
  let lastDecayAt = 0;

  const litPeak = (i: number, on: boolean) => {
    if (i >= 0 && i < segments.length) segments[i].classList.toggle('lit-peak', on);
  };

  return {
    el,
    set(dbfs, now) {
      const litCount = litCountForDb(dbfs);

      // Only the segments that CHANGED. A meter touching fourteen class lists
      // sixty times a second, per lane, is the kind of per-frame work that shows
      // up as jank on a full rack.
      if (litCount !== lastLitCount) {
        const lo = Math.min(litCount, lastLitCount);
        const hi = Math.max(litCount, lastLitCount);
        for (let i = lo; i < hi; i++) {
          if (i < segments.length) segments[i].classList.toggle('lit', i < litCount);
        }
        lastLitCount = litCount;
      }

      const top = litCount - 1;
      if (top >= peakIdx) {
        litPeak(peakIdx, false);
        peakIdx = top;
        heldUntil = now + PEAK_HOLD_MS;
        litPeak(peakIdx, true);
      } else if (now > heldUntil && now > lastDecayAt + PEAK_DECAY_MS) {
        litPeak(peakIdx, false);
        peakIdx--;
        lastDecayAt = now;
        litPeak(peakIdx, true);
      }
    },
  };
}
