/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderDrumVoiceRack } from './drum-voice-rack';
import { DrumsEngine } from './drums-engine';
import type { EngineUIContext } from './engine-types';

function makeCtx(registered: string[]): EngineUIContext {
  return {
    laneId: 'drums-1',
    registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) registered.push(k.meta.id); },
    registry: new Map<string, unknown>(),
  } as unknown as EngineUIContext;
}

describe('renderDrumVoiceRack', () => {
  it('renders 8 voice columns', () => {
    const host = document.createElement('div');
    renderDrumVoiceRack(new DrumsEngine(), makeCtx([]), host);
    expect(host.querySelectorAll('.dv-col').length).toBe(8);
  });

  it('registers curated + mixer knob ids per voice under the lane prefix', () => {
    const host = document.createElement('div');
    const ids: string[] = [];
    renderDrumVoiceRack(new DrumsEngine(), makeCtx(ids), host);
    expect(ids).toContain('drums-1.kick.tune');
    expect(ids).toContain('drums-1.kick.rev');
    expect(ids).toContain('drums-1.snare.snap');
    // advanced ids are rendered too (collapsed, but registered):
    expect(ids).toContain('drums-1.kick.startFreq');
    expect(ids).toContain('drums-1.kick.wave');
  });

  it('advanced block is collapsed by default and toggles on click', () => {
    const host = document.createElement('div');
    renderDrumVoiceRack(new DrumsEngine(), makeCtx([]), host);
    const adv = host.querySelector('.dv-advanced') as HTMLElement;
    const btn = host.querySelector('.dv-adv-toggle') as HTMLButtonElement;
    expect(adv.classList.contains('open')).toBe(false);
    btn.click();
    expect(adv.classList.contains('open')).toBe(true);
  });
});
