// @vitest-environment jsdom
// Characterisation of the NOTE FX panel after the lit-html migration: render
// structure (panel, header, cards) and the main interactions (add, toggle,
// param edit, remove, re-adoption after a caller wipe). The chain is the real
// NoteFxChain — pure state, no audio.

import { describe, it, expect, vi } from 'vitest';
import { renderNoteFxPanel, type NoteFxUIDeps } from './notefx-ui';
import { NoteFxChain } from './notefx-chain';

function mount(chain = new NoteFxChain([])) {
  const container = document.createElement('div');
  const onChange = vi.fn();
  const deps: NoteFxUIDeps = { laneId: 'lane-1', chain, onChange };
  renderNoteFxPanel(container, deps);
  return { container, chain, onChange, deps };
}

const headerButtons = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLButtonElement>('.mod-panel-header button')];

describe('renderNoteFxPanel', () => {
  it('renders the panel box, title and all adders', () => {
    const { container } = mount();
    const panel = container.querySelector('.notefx-panel')!;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.mod-panel-title')!.textContent).toBe('NOTE FX');
    expect(headerButtons(container).map((b) => b.textContent)).toEqual(['+ Arp', '+ Chord', '+ Random']);
  });

  it('+ Arp adds a card, syncs the chain into onChange, and repaints in place', () => {
    const { container, chain, onChange } = mount();
    headerButtons(container)[0].click();
    expect(chain.noteFx).toHaveLength(1);
    expect(chain.noteFx[0].kind).toBe('arp');
    expect(onChange).toHaveBeenCalledWith(chain.serialize());
    const card = container.querySelector('.notefx-card.notefx-arp')!;
    expect(card).toBeTruthy();
    expect(card.querySelector('.notefx-card-row span')!.textContent).toBe('ARP1');
    // Only ONE panel: the repaint patched the existing host, no duplicate mount.
    expect(container.querySelectorAll('.notefx-panel')).toHaveLength(1);
  });

  // A control that APPEARS needs the card repainted; one that only changes a
  // value does not. `set` alone was right for every knob on the card and wrong
  // for PATTERN — which shipped, briefly, as a dropdown that offered `steps`,
  // accepted it, and showed no field. Caught in the browser, not by the suite;
  // these two are why the suite would catch it next time.
  const patternSelect = (c: HTMLElement) =>
    [...c.querySelectorAll<HTMLSelectElement>('.notefx-arp select')]
      .find((s) => [...s.options].some((o) => o.value === 'steps'))!;

  const choose = (sel: HTMLSelectElement, value: string) => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('choosing the written PATTERN reveals its field, on the spot', () => {
    const { container, chain } = mount();
    headerButtons(container)[0].click(); // + Arp
    expect(container.querySelectorAll('.notefx-steps')).toHaveLength(0);

    choose(patternSelect(container), 'steps');
    expect(chain.noteFx[0].params.pattern).toBe('steps');

    // A ROW OF BARS, not a text box: this shipped as a text field first, which
    // was the encoding solved and the editor not built.
    const row = container.querySelector('.notefx-steps .steps-control')!;
    expect(row).toBeTruthy();
    // Opening on the upward walk it already played: switching pattern changes
    // nothing until you edit it. Four steps, none of them a rest.
    const bars = [...row.querySelectorAll('.step-bar')];
    expect(bars).toHaveLength(4);
    expect(bars.filter((b) => b.classList.contains('rest'))).toHaveLength(0);
  });

  it('choosing a shape again takes the field away', () => {
    const { container } = mount();
    headerButtons(container)[0].click();
    choose(patternSelect(container), 'steps');
    expect(container.querySelectorAll('.notefx-steps')).toHaveLength(1);
    choose(patternSelect(container), 'up');
    expect(container.querySelectorAll('.notefx-steps')).toHaveLength(0);
  });

  it('the edited pattern reaches the chain', () => {
    const { container, chain, onChange } = mount();
    headerButtons(container)[0].click();
    choose(patternSelect(container), 'steps');

    // Lengthen it: the cheapest edit to drive from a test, and it exercises the
    // same road a painted bar takes — editor → written form → chain.
    container.querySelector<HTMLButtonElement>('.arp-steps-len button:last-child')!.click();

    expect(String(chain.noteFx[0].params.steps).split(/\s+/)).toHaveLength(5);
    expect(onChange).toHaveBeenCalledWith(chain.serialize());
  });

  it('keeps the SAME editor across a repaint, so a stroke is not interrupted', () => {
    // Rebuilding it per paint would destroy the row a pointer is painting on —
    // the fault the WEAVE panel shipped twice as "the fader cannot be dragged".
    const { container } = mount();
    headerButtons(container)[0].click();
    choose(patternSelect(container), 'steps');
    const before = container.querySelector('.notefx-steps .steps-control');

    // Any repaint of the card.
    container.querySelector<HTMLButtonElement>('.notefx-card-row button')!.click();
    expect(container.querySelector('.notefx-steps .steps-control')).toBe(before);
  });

  it('the enable button toggles state and its own label', () => {
    const { container, chain } = mount();
    headerButtons(container)[1].click(); // + Chord
    const toggleBtn = container.querySelector<HTMLButtonElement>('.notefx-card-row button')!;
    expect(toggleBtn.textContent).toBe('ON');
    toggleBtn.click();
    expect(chain.noteFx[0].enabled).toBe(false);
    expect(toggleBtn.textContent).toBe('OFF');
  });

  it('a field select edit writes the param and syncs, without a rebuild', () => {
    const { container, chain, onChange } = mount();
    headerButtons(container)[0].click(); // + Arp
    const patternSel = container.querySelector<HTMLSelectElement>('.notefx-field select')!;
    onChange.mockClear();
    patternSel.value = 'down';
    patternSel.dispatchEvent(new Event('change'));
    expect(chain.noteFx[0].params.pattern).toBe('down');
    expect(onChange).toHaveBeenCalledWith(chain.serialize());
    // No repaint on a param edit — the select the user just touched stays put.
    expect(container.querySelector<HTMLSelectElement>('.notefx-field select')).toBe(patternSel);
  });

  it('× removes the card and the chain entry', () => {
    const { container, chain } = mount();
    headerButtons(container)[0].click();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.notefx-card-row button')];
    buttons[1].click(); // ×
    expect(chain.noteFx).toHaveLength(0);
    expect(container.querySelector('.notefx-card')).toBeNull();
  });

  it('survives the caller wiping the container and re-rendering (re-adoption)', () => {
    const { container, chain, deps } = mount();
    headerButtons(container)[0].click();
    // The lane editor rebuild path: innerHTML wipe + a fresh render call.
    container.innerHTML = '';
    renderNoteFxPanel(container, { ...deps });
    expect(container.querySelectorAll('.notefx-panel')).toHaveLength(1);
    expect(container.querySelectorAll('.notefx-card')).toHaveLength(chain.noteFx.length);
  });
});
