// src/core/select-control.ts
// Discrete-value automatable controls (selects + toggles). The automation
// system feeds 0..1 normalized values; we quantise to an option index. The
// inverse picks the mid-bucket normalized value so the registered current
// value rountrips through automation cleanly.

import type { KnobHandle, KnobMeta } from './knob';

export interface SelectControlOpts {
  id: string;                  // automation registry id
  label?: string;
  options: Array<{ value: string; label: string }>;
  initialValue: string;
  onChange: (value: string, fromUser: boolean) => void;
}

export function quantiseSelectValue(norm: number, optionCount: number): number {
  return Math.max(0, Math.min(optionCount - 1, Math.floor(norm * optionCount)));
}

export function normaliseSelectIndex(idx: number, optionCount: number): number {
  return (idx + 0.5) / optionCount;
}

export function createSelectControl(opts: SelectControlOpts): {
  el: HTMLSelectElement;
  handle: KnobHandle;
} {
  const sel = document.createElement('select');
  sel.className = 'select-control';
  for (const o of opts.options) {
    const optEl = document.createElement('option');
    optEl.value = o.value;
    optEl.textContent = o.label;
    sel.appendChild(optEl);
  }
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
    },
    setModulationOffset: () => { /* discrete controls don't show a ring */ },
  };

  sel.addEventListener('change', () => {
    const idx = opts.options.findIndex((o) => o.value === sel.value);
    const v = normaliseSelectIndex(Math.max(0, idx), opts.options.length);
    opts.onChange(sel.value, true);
    handle.onValueChanged?.(v, true);
  });

  return { el: sel, handle };
}
