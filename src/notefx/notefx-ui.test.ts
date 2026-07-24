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
  it('renders the panel box, title and both adders', () => {
    const { container } = mount();
    const panel = container.querySelector('.notefx-panel')!;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.mod-panel-title')!.textContent).toBe('NOTE FX');
    expect(headerButtons(container).map((b) => b.textContent)).toEqual(['+ Arp', '+ Chord']);
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
