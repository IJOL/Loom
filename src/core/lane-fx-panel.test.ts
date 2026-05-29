// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { mountLaneFxPanel } from './lane-fx-panel';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';
import type { KnobHandle } from './knob';

describe('mountLaneFxPanel', () => {
  let ctx: AudioContext;
  let fx: FxBus;
  let bus: SidechainBus;
  let strip: ChannelStrip;
  let parent: HTMLElement;
  let registered: KnobHandle[];

  beforeEach(() => {
    ctx = new AudioContext();
    fx = new FxBus(ctx, ctx.destination);
    bus = new SidechainBus();
    strip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'tb-303-1', label: '303 1' },
    });
    parent = document.createElement('div');
    registered = [];
  });

  function mount(): void {
    mountLaneFxPanel({
      laneId: 'tb-303-1',
      strip,
      bus,
      parent,
      registerKnob: (k) => registered.push(k),
    });
  }

  it('clears parent and appends COMP + SC subsections', () => {
    parent.innerHTML = '<span>old</span>';
    mount();
    expect(parent.querySelector('.lane-fx-comp')).toBeTruthy();
    expect(parent.querySelector('.lane-fx-sc')).toBeTruthy();
    expect(parent.querySelector('span')).toBeNull();
  });

  it('registers knobs under the <laneId>.fx.* prefix', () => {
    mount();
    const ids = registered.map((k) => k.meta.id);
    expect(ids).toContain('tb-303-1.fx.comp.thr');
    expect(ids).toContain('tb-303-1.fx.comp.mkup');
    expect(ids).toContain('tb-303-1.fx.sc.depth');
  });

  it('moving a COMP knob writes through to strip.getCompState()', () => {
    mount();
    const thr = registered.find((k) => k.meta.id === 'tb-303-1.fx.comp.thr');
    expect(thr).toBeTruthy();
    thr!.setValue(-12);
    expect(strip.getCompState().threshold).toBeCloseTo(-12, 5);
  });

  it('BYP button toggles strip.getCompState().bypass', () => {
    mount();
    const byp = parent.querySelector('.lane-fx-bypass') as HTMLButtonElement;
    expect(strip.getCompState().bypass).toBe(true);
    byp.click();
    expect(strip.getCompState().bypass).toBe(false);
    byp.click();
    expect(strip.getCompState().bypass).toBe(true);
  });

  it('SC SRC select shows other lanes; selecting one writes through to strip.getSidechain().source', () => {
    new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'drums-1', label: 'Drums 1' },
    });
    mount();
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain('');
    expect(opts).toContain('drums-1');
    sel.value = 'drums-1';
    sel.dispatchEvent(new Event('change'));
    expect(strip.getSidechain()?.source).toBe('drums-1');
  });

  it('SC DEPTH/ATK/REL knobs are hidden until a source is selected', () => {
    mount();
    const box = parent.querySelector('.lane-fx-sc-knobs') as HTMLElement;
    expect(box.style.display).toBe('none');

    new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'drums-1', label: 'Drums 1' },
    });
    parent.innerHTML = ''; registered.length = 0; mount();
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    sel.value = 'drums-1';
    sel.dispatchEvent(new Event('change'));
    const box2 = parent.querySelector('.lane-fx-sc-knobs') as HTMLElement;
    expect(box2.style.display).not.toBe('none');
  });

  it('SC SRC label uses lookupLabel when provided', () => {
    new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'drums-1', label: 'DRUMS' },
    });
    parent.innerHTML = '';
    mountLaneFxPanel({
      laneId: 'tb-303-1', strip, bus, parent,
      registerKnob: (k) => registered.push(k),
      lookupLabel: (id) => (id === 'drums-1' ? 'My Drums' : undefined),
    });
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    const drumsOpt = Array.from(sel.options).find((o) => o.value === 'drums-1');
    expect(drumsOpt?.textContent).toBe('My Drums');
  });
});
