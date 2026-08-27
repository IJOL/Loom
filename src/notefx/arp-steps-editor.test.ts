// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createArpStepsEditor, stepToHeight, heightToStep, ARP_RUNGS,
} from './arp-steps-editor';
import { REST } from './arp-steps';

describe('a rung and its height', () => {
  it('puts a REST on the floor and every index above it', () => {
    expect(stepToHeight(REST)).toBe(0);
    for (let i = 0; i < ARP_RUNGS; i++) expect(stepToHeight(i)).toBeGreaterThan(0);
  });

  it('climbs with the index', () => {
    for (let i = 1; i < ARP_RUNGS; i++) {
      expect(stepToHeight(i)).toBeGreaterThan(stepToHeight(i - 1));
    }
  });

  it('round-trips every rung', () => {
    expect(heightToStep(stepToHeight(REST))).toBe(REST);
    for (let i = 0; i < ARP_RUNGS; i++) expect(heightToStep(stepToHeight(i))).toBe(i);
  });

  it('answers a step for ANY height the control can hand back', () => {
    // The row reports a continuum; every value in it has to mean something.
    for (let v = 0; v <= 1.0001; v += 0.017) {
      const s = heightToStep(v);
      expect(s === REST || (s >= 0 && s < ARP_RUNGS)).toBe(true);
    }
  });

  it('folds an index past the rungs rather than falling off', () => {
    // Indices WRAP over the pool, so the editor has to show something for one
    // written beyond its own range.
    expect(stepToHeight(ARP_RUNGS)).toBe(stepToHeight(0));
  });
});

describe('the editor', () => {
  const bars = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.step-bar')];

  it('draws one bar per step of the written pattern', () => {
    const ed = createArpStepsEditor({ value: '0 2 . 4 1', onChange: vi.fn() });
    expect(bars(ed.el)).toHaveLength(5);
  });

  it('draws a rest as an empty slot, not as a short bar', () => {
    const ed = createArpStepsEditor({ value: '3 . 3 .', onChange: vi.fn() });
    const rests = bars(ed.el).filter((b) => b.classList.contains('rest'));
    expect(rests).toHaveLength(2);
    for (const r of rests) expect(r.style.height).toBe('0%');
  });

  it('gives a pattern of nothing a row you can still paint on', () => {
    // An empty pattern is a legal thing to have; a row of zero bars is not a
    // row, and there would be no way back to a pattern from it.
    const ed = createArpStepsEditor({ value: '', onChange: vi.fn() });
    expect(bars(ed.el).length).toBeGreaterThan(0);
  });

  it('hands the pattern back in the SAME written form it was given', () => {
    // The string stays the one source of truth: the editor is a view of it.
    const onChange = vi.fn();
    const ed = createArpStepsEditor({ value: '0 1 2 3', onChange });
    ed.el.querySelector<HTMLButtonElement>('.arp-steps-len button:last-child')!.click();
    expect(onChange).toHaveBeenCalled();
    const src = onChange.mock.calls.at(-1)![0] as string;
    expect(src.split(/\s+/)).toHaveLength(5);
    expect(src).toMatch(/^[-\d. ]+$/);
  });

  it('lengthens by copying the LAST step, never by adding a rest', () => {
    // Predictable, always audible, one stroke from anything else. "Repeat the
    // cycle" was the first idea and it is not well defined once the pattern has
    // grown: after 0 3 → 0 3 0 there is no answer to what the cycle is.
    const onChange = vi.fn();
    const ed = createArpStepsEditor({ value: '0 3', onChange });
    const plus = ed.el.querySelector<HTMLButtonElement>('.arp-steps-len button:last-child')!;
    plus.click();
    plus.click();
    expect(onChange.mock.calls.at(-1)![0]).toBe('0 3 3 3');
  });

  it('lengthens a pattern of rests without inventing a note', () => {
    const onChange = vi.fn();
    const ed = createArpStepsEditor({ value: '.', onChange });
    ed.el.querySelector<HTMLButtonElement>('.arp-steps-len button:last-child')!.click();
    expect(onChange.mock.calls.at(-1)![0]).toBe('. .');
  });

  it('shortens, and never below one step', () => {
    const onChange = vi.fn();
    const ed = createArpStepsEditor({ value: '0 1 2', onChange });
    const minus = ed.el.querySelector<HTMLButtonElement>('.arp-steps-len button')!;
    for (let i = 0; i < 6; i++) minus.click();
    const src = onChange.mock.calls.at(-1)![0] as string;
    expect(src.split(/\s+/)).toHaveLength(1);
  });

  it('repaints from a pattern set from outside — an undo, a preset, a load', () => {
    const ed = createArpStepsEditor({ value: '0 0 0 0', onChange: vi.fn() });
    expect(bars(ed.el).filter((b) => b.classList.contains('rest'))).toHaveLength(0);
    ed.set('. . . .');
    expect(bars(ed.el).filter((b) => b.classList.contains('rest'))).toHaveLength(4);
  });

  it('rebuilds when a pattern of another LENGTH arrives', () => {
    const ed = createArpStepsEditor({ value: '0 1', onChange: vi.fn() });
    ed.set('0 1 2 3 4 5');
    expect(bars(ed.el)).toHaveLength(6);
  });
});
