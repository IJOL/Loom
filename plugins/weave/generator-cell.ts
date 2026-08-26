// The GENERATOR on a lane row: one switch, and a line of controls under it.
//
// A LINE of its own rather than a cell in the setup grid, and that is not a
// layout preference. `weave-lane-setup` declares a column per control, and the
// row has already been broken once by a control added without one — everything
// after it slid a column left and the octave buttons stretched across the
// filler. Nine controls could not have a column each; a line underneath needs
// none, and it costs nothing on a lane that is not generating.
//
// The controls are DRAWN FROM DATA. The host declares them as
// `PanelGeneratorParam[]` and this file has no idea what CADENCE means or what
// range DIV has — which is the point, because the spec has four streams of five
// controls each still to arrive and every one of them would otherwise be an
// edit here, in the SDK and in the host.

import type { PanelContext, PanelGeneratorParam } from '@loom/plugin-sdk';

const el = (tag: string, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export interface GeneratorCell {
  /** The switch, for the setup row. */
  toggle: HTMLElement;
  /** The controls, for the line under the lane. Empty when it is off. */
  line: HTMLElement;
}

/** How a value reads to a person: a label when the control is a choice wearing
 *  a number, an integer when it lands on whole values, two decimals otherwise.
 *
 *  The host will not guess this — a knob over three named choices and one over
 *  a bar count are the same number and different words — so `Loom.controls.knob`
 *  takes it as `format`. */
function readout(p: PanelGeneratorParam, v: number): string {
  if (p.labels) return p.labels[Math.round(v)] ?? String(v);
  return p.step > 0 ? String(Math.round(v)) : v.toFixed(2);
}

function control(
  ctx: PanelContext, laneId: string, p: PanelGeneratorParam,
): HTMLElement {
  const wrap = el('div', 'weave-gen-param');
  wrap.dataset.gen = p.id;

  // The APP's knob, through the catalogue the host hands over for exactly this.
  // Nineteen range inputs was the first shape and it read as a settings sheet
  // rather than an instrument — and drawing an arc here instead would have put
  // a THIRD knob in a panel that already has the macro dial and the endless
  // dial. The host owns the drawing; this only places it.
  const k = Loom.controls.knob({
    min: p.min,
    max: p.max,
    value: p.value,
    step: p.step > 0 ? p.step : undefined,
    label: p.name,
    size: 34,
    format: (v) => readout(p, v),
    // NOT followed by a refresh. `refresh()` remounts the whole panel, which
    // destroys the element the pointer is holding: the click survives and the
    // drag dies on the second event. That has shipped twice here as "the fader
    // cannot be dragged", and the host's setter is deliberately silent for the
    // same reason.
    onChange: (v) => ctx.setGeneratorParam(laneId, p.id, v),
  });

  wrap.appendChild(k.el);
  return wrap;
}

export function generatorCell(ctx: PanelContext, laneId: string): GeneratorCell {
  const on = ctx.generatorOn(laneId);

  const toggle = el('button', `weave-tbtn weave-gen-on${on ? ' on' : ''}`, 'GEN') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.title = on
    ? 'Stop generating — the lane goes back to its clips'
    : 'Generate: a read head over this lane\'s own loops, instead of playing them';
  toggle.addEventListener('click', () => {
    // Here refresh IS right, and it is the host that calls it: a whole line of
    // controls appears and disappears, which is the one case remounting is for.
    ctx.setGeneratorOn(laneId, !ctx.generatorOn(laneId));
  });

  const line = el('div', 'weave-lane-gen');
  const params = ctx.generatorParams(laneId);
  // An EMPTY list is how the host says "show no control" — the same convention
  // roleChoices and followChoices use, and it is what a lane that is not
  // generating answers. The line is still built, still empty, and costs a
  // zero-height block: a line that came and went would move every lane under it.
  for (const p of params) line.appendChild(control(ctx, laneId, p));

  return { toggle, line };
}
