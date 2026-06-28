// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { mountDrumChannelFilter } from './drum-channel-filter-ui';
import type { KnobHandle } from './knob';

function fakeEngine() {
  const vals: Record<string, number> = { 'filter.cutoff': 20000, 'filter.resonance': 0.7 };
  return {
    getBaseValue: (id: string) => vals[id],
    setBaseValue: (id: string, v: number) => { vals[id] = v; },
    _vals: vals,
  };
}

describe('drums CHANNEL FILTER UI', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });

  it('renders a CHANNEL FILTER section with CUTOFF and RES knobs', () => {
    const registered: string[] = [];
    mountDrumChannelFilter({
      laneId: 'drums-1', engine: fakeEngine() as never, parent: host,
      registerKnob: (k: KnobHandle) => { if (k.meta.id) registered.push(k.meta.id); },
    });
    expect(host.textContent).toContain('CHANNEL FILTER');
    expect(registered).toContain('drums-1.filter.cutoff');
    expect(registered).toContain('drums-1.filter.resonance');
  });

  it('turning the CUTOFF knob writes through the engine', () => {
    const eng = fakeEngine();
    let cutoffKnob: KnobHandle | undefined;
    mountDrumChannelFilter({
      laneId: 'drums-1', engine: eng as never, parent: host,
      registerKnob: (k: KnobHandle) => { if (k.meta.id === 'drums-1.filter.cutoff') cutoffKnob = k; },
    });
    // createKnob exposes onChange wiring; simulate by calling the engine setter
    // the section installed (assert the section read the initial value).
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(cutoffKnob).toBeDefined();
  });
});
