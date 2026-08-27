// The arp's pattern, as a row of bars you paint.
//
// It shipped first as a text field, which was the encoding solved and the
// EDITOR not built — you could write "0 . 2 4" and never see the shape you were
// making. This is the shape.
//
// Built on `core/controls/steps-control`, the row the WEAVE step rack and the
// automation lanes already use, rather than on a fresh grid: the app has one
// step row and it should keep having one. What it needed was two opt-in
// behaviours it did not have — whole rungs, and a bar that can reach zero and
// mean REST — and those are worth more than this one caller.
//
// The bar height is a POOL INDEX, not a pitch. The pool changes under the
// pattern as the scale, the octave count and the played note change, so the
// editor cannot show you notes without lying about which ones. Rungs it is.

import { createStepsControl, type StepsHandle } from '../core/controls/steps-control';
import {
  parseArpSteps, formatArpSteps, type ArpStep, REST,
} from './arp-steps';

/** How many rungs a bar can land on, ABOVE the rest.
 *
 *  Eight because a pool is usually five to seven notes (a pentatonic to a
 *  diatonic octave) and the indices WRAP, so eight reaches every note of every
 *  common scale and a little beyond. More rungs would be finer than the thing
 *  being chosen; fewer would put some of the pool out of reach. */
export const ARP_RUNGS = 8;

/** Rung → bar height. Rest is 0; index i is one rung above it. */
export function stepToHeight(step: ArpStep): number {
  if (step === REST) return 0;
  const i = ((step % ARP_RUNGS) + ARP_RUNGS) % ARP_RUNGS;
  return (i + 1) / ARP_RUNGS;
}

/** Bar height → rung. The inverse, and deliberately total: the control can hand
 *  back anything in 0..1 and every value has to mean a step. */
export function heightToStep(v: number): ArpStep {
  if (!(v > 0)) return REST;
  return Math.min(ARP_RUNGS - 1, Math.max(0, Math.round(v * ARP_RUNGS) - 1));
}

export interface ArpStepsEditor {
  el: HTMLElement;
  /** Repaint from a written pattern — for an undo, a preset, a load. */
  set(src: string): void;
}

export interface ArpStepsEditorOpts {
  /** The pattern as stored: `parseArpSteps` reads it. */
  value: string;
  /** Handed the pattern back in the same written form, so the state stays one
   *  string and the text encoding remains the single source of truth. */
  onChange(src: string): void;
  label?: string;
}

/** How many steps a pattern gets when it has none at all. Four, because that is
 *  the default pattern's length and a row of one is not a row. */
const FALLBACK_LEN = 4;

export function createArpStepsEditor(opts: ArpStepsEditorOpts): ArpStepsEditor {
  let steps: ArpStep[] = parseArpSteps(opts.value);
  if (steps.length === 0) steps = new Array(FALLBACK_LEN).fill(REST);

  const el = document.createElement('div');
  el.className = 'arp-steps-editor';

  let row: StepsHandle | null = null;

  const commit = () => opts.onChange(formatArpSteps(steps));

  /** The row is REBUILT when the step COUNT changes and only then — its column
   *  template and its bar list are both fixed at construction. Painting is the
   *  other path and it keeps the element the pointer may be holding. */
  const build = () => {
    row = createStepsControl({
      values: steps.map(stepToHeight),
      label: opts.label ?? 'Arp pattern',
      levels: ARP_RUNGS + 1,      // the rungs, plus the rest at the bottom
      restAt0: true,
      onChange: (i, v) => {
        steps[i] = heightToStep(v);
        commit();
      },
    });
    el.replaceChildren(row.el, controls);
  };

  const resize = (delta: number) => {
    const next = Math.max(1, Math.min(32, steps.length + delta));
    if (next === steps.length) return;
    if (next > steps.length) {
      // A new step copies the LAST one. "Repeat the cycle" was the first idea
      // and it is not well defined once the pattern has grown — after 0 3 → 0 3 0
      // there is no answer to what the cycle is any more. Copying the last step
      // is predictable, always audible, and one stroke away from anything else;
      // arriving as a rest would leave a longer pattern quieter than the one
      // you started from, which is not what pressing + asks for.
      while (steps.length < next) steps.push(steps[steps.length - 1] ?? REST);
    } else {
      steps.length = next;
    }
    build();
    commit();
  };

  const controls = document.createElement('div');
  controls.className = 'arp-steps-len';
  const btn = (text: string, title: string, on: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rnd';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', on);
    controls.appendChild(b);
    return b;
  };
  btn('−', 'One step shorter', () => resize(-1));
  btn('+', 'One step longer', () => resize(1));

  build();

  return {
    el,
    set(src) {
      const next = parseArpSteps(src);
      if (next.length !== steps.length) {
        steps = next.length ? next : new Array(FALLBACK_LEN).fill(REST);
        build();
        return;
      }
      steps = next;
      row?.set(steps.map(stepToHeight));
    },
  };
}
