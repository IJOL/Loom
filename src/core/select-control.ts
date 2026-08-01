// src/core/select-control.ts
// Discrete-value automatable controls. The automation system feeds 0..1
// normalized values; we quantise to an option index. The inverse picks the
// mid-bucket normalized value so the registered current value roundtrips
// through automation cleanly.
//
// Rendering: with ≤ 4 options we paint a radio strip (graphical when option
// values match known waveform shapes, plain text otherwise); with > 4
// options, or `forceSelect`, we fall back to the native <select>. The
// returned `el` is typed as HTMLElement either way — callers use `.el` for
// layout only.
//
// THE rule for every discrete PARAM control, on every surface that draws one
// (see engine-param-grid.ts's header for the full list, which includes the
// FX insert rack): pass `compact: true`. That strip stacks VERTICALLY and is
// fixed to a knob's footprint (~50px wide) so a row of mixed controls
// aligns. Without `compact`, the strip stays the base HORIZONTAL shape — the
// modulator-config panel (LFO WAVE/POLARITY/RETRIG) relies on that default
// and must NOT opt in: its cards lay out in a row, and the vertical strip
// stretched them the one time this leaked (Task 8b fix round 2).
//
// DOM is built once via a one-time lit-html render into a detached fragment;
// the active-state refresh and data-value-norm updates stay imperative on the
// kept refs (these controls are automation targets that must survive drags and
// programmatic setValue without a template diff).

import { html, render as litRender, type TemplateResult } from 'lit-html';
import type { KnobHandle, KnobMeta } from './knob';

export interface SelectControlOpts {
  id: string;                  // automation registry id
  label?: string;
  options: Array<{ value: string; label: string }>;
  initialValue: string;
  onChange: (value: string, fromUser: boolean) => void;
  /** Force the native <select> rendering even with ≤4 options (used for
   *  long-labelled option sets like the FM algorithm). */
  forceSelect?: boolean;
  /** Show the param label above the control. Off by default (WAVE/FM render
   *  bare); on for controls whose option text isn't self-describing (CHOKE). */
  showLabel?: boolean;
  /** Radio-strip only: stack vertically at a fixed ~50px width (a knob's own
   *  footprint) instead of the base horizontal strip. Opt-in — pass `true`
   *  ONLY from a param-editing surface (buildControl in engine-param-grid.ts,
   *  the FX insert rack). The modulator-config panel must leave this unset;
   *  its horizontally-laid-out cards break when the strip goes vertical. */
  compact?: boolean;
}

export function quantiseSelectValue(norm: number, optionCount: number): number {
  return Math.max(0, Math.min(optionCount - 1, Math.floor(norm * optionCount)));
}

export function normaliseSelectIndex(idx: number, optionCount: number): number {
  return (idx + 0.5) / optionCount;
}

// Built-in glyph paths drawn on a 28×16 viewBox. When an option `value`
// matches one of these keys (waveform names), the radio button paints the
// glyph instead of the text label.
const WAVEFORM_GLYPHS: Record<string, string> = {
  sine:     'M 2 8 Q 5 1 8 8 T 14 8 T 20 8 T 26 8',
  triangle: 'M 2 8 L 7 1 L 14 15 L 21 1 L 26 8',
  square:   'M 2 14 L 2 2 L 9 2 L 9 14 L 16 14 L 16 2 L 23 2 L 23 14 L 26 14',
  sawtooth: 'M 2 14 L 8 2 L 8 14 L 15 2 L 15 14 L 22 2 L 22 14',
  saw:      'M 2 14 L 8 2 L 8 14 L 15 2 L 15 14 L 22 2 L 22 14',
};

function waveformGlyphTemplate(path: string): TemplateResult {
  return html`<svg class="radio-glyph" viewBox="0 0 28 16" width="24" height="14"><path
    d=${path} fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function createRadioStrip(opts: SelectControlOpts): { el: HTMLElement; handle: KnobHandle } {
  const refresh = (active: string) => {
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', opts.options[i].value === active);
    }
  };

  const onPick = (o: { value: string; label: string }) => () => {
    const next = o.value;
    refresh(next);
    const idx = opts.options.findIndex((x) => x.value === next);
    const v = normaliseSelectIndex(Math.max(0, idx), opts.options.length);
    opts.onChange(next, true);
    const norm = opts.options.length <= 1 ? 0 : Math.max(0, idx) / (opts.options.length - 1);
    handle.el.setAttribute('data-value-norm', String(norm));
    handle.onValueChanged?.(v, true);
  };

  const stripClass = opts.compact ? 'radio-strip radio-strip--compact' : 'radio-strip';
  const frag = document.createDocumentFragment();
  litRender(html`
    <div class=${stripClass}>
      ${opts.options.map((o) => {
        const glyph = WAVEFORM_GLYPHS[o.value];
        return html`<button type="button" class="radio-btn" title=${o.label}
          @click=${onPick(o)}>${glyph ? waveformGlyphTemplate(glyph) : o.label}</button>`;
      })}
    </div>
  `, frag);
  const wrap = frag.firstElementChild as HTMLElement;
  const buttons = [...wrap.querySelectorAll<HTMLButtonElement>('button.radio-btn')];

  let current = opts.initialValue;
  refresh(current);

  const meta: KnobMeta = { id: opts.id, label: opts.label, min: 0, max: 1 };
  const handle: KnobHandle = {
    el: wrap,
    meta,
    setValue: (v: number) => {
      const idx = quantiseSelectValue(v, opts.options.length);
      const next = opts.options[idx].value;
      if (current !== next) {
        current = next;
        refresh(next);
        opts.onChange(next, false);
        handle.onValueChanged?.(v, false);
      }
      const norm = opts.options.length <= 1 ? 0 : idx / (opts.options.length - 1);
      handle.el.setAttribute('data-value-norm', String(norm));
    },
    setModulationOffset: () => { /* discrete controls don't show a ring */ },
  };

  // Set initial data-value-norm
  const initialIdx = opts.options.findIndex((o) => o.value === opts.initialValue);
  const initialNorm = opts.options.length <= 1 ? 0 : Math.max(0, initialIdx) / (opts.options.length - 1);
  wrap.setAttribute('data-value-norm', String(initialNorm));

  return { el: wrap, handle };
}

function createNativeSelect(opts: SelectControlOpts): { el: HTMLElement; handle: KnobHandle } {
  const onNativeChange = () => {
    const idx = opts.options.findIndex((o) => o.value === sel.value);
    const v = normaliseSelectIndex(Math.max(0, idx), opts.options.length);
    opts.onChange(sel.value, true);
    const norm = opts.options.length <= 1 ? 0 : Math.max(0, idx) / (opts.options.length - 1);
    handle.el.setAttribute('data-value-norm', String(norm));
    handle.onValueChanged?.(v, true);
  };

  const frag = document.createDocumentFragment();
  litRender(html`
    <select class="select-control" @change=${onNativeChange}>
      ${opts.options.map((o) => html`<option value=${o.value}>${o.label}</option>`)}
    </select>
  `, frag);
  const sel = frag.firstElementChild as HTMLSelectElement;
  // Options must exist before the current value can stick.
  sel.value = opts.initialValue;

  const meta: KnobMeta = { id: opts.id, label: opts.label, min: 0, max: 1 };
  const handle: KnobHandle = {
    el: sel,
    meta,
    setValue: (v: number) => {
      const idx = quantiseSelectValue(v, opts.options.length);
      const next = opts.options[idx].value;
      if (sel.value !== next) {
        sel.value = next;
        opts.onChange(next, false);
        handle.onValueChanged?.(v, false);
      }
      const norm = opts.options.length <= 1 ? 0 : idx / (opts.options.length - 1);
      handle.el.setAttribute('data-value-norm', String(norm));
    },
    setModulationOffset: () => { /* discrete controls don't show a ring */ },
  };

  // Set initial data-value-norm
  const initialIdx = opts.options.findIndex((o) => o.value === opts.initialValue);
  const initialNorm = opts.options.length <= 1 ? 0 : Math.max(0, initialIdx) / (opts.options.length - 1);
  sel.setAttribute('data-value-norm', String(initialNorm));

  return { el: sel, handle };
}

export function createSelectControl(opts: SelectControlOpts): { el: HTMLElement; handle: KnobHandle } {
  const useStrip = !opts.forceSelect && opts.options.length <= 4;
  const built = useStrip ? createRadioStrip(opts) : createNativeSelect(opts);
  // Optionally wrap with a small caption so non-self-describing controls (CHOKE)
  // read clearly in a dense rack. handle.el stays the control (automation target);
  // only the layout `el` becomes the captioned wrapper.
  if (opts.showLabel && opts.label) {
    const frag = document.createDocumentFragment();
    litRender(
      html`<div class="select-labeled"><span class="ctl-label">${opts.label}</span>${built.el}</div>`,
      frag,
    );
    return { el: frag.firstElementChild as HTMLElement, handle: built.handle };
  }
  return built;
}
