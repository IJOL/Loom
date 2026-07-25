// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../../test/setup';
import { mountLaneFxPanel, sidechainSummary } from './lane-fx-panel';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';
import type { KnobHandle } from './knob';

/** Extract one top-level SCSS block so a layout rule can be asserted from the
 *  stylesheet itself: jsdom applies inline/attribute styles but never our SCSS,
 *  so the row layout has nowhere else to be pinned. */
function scssBlock(src: string, selector: string): string | null {
  const at = src.indexOf(`${selector} {`);
  if (at < 0) return null;
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return null;
}

// vitest runs with cwd = project root (vitest.config.ts lives there).
const FX_SCSS = readFileSync(resolve(process.cwd(), 'src/styles/_fx.scss'), 'utf8');

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

  /** Registers a second lane so the SC dropdown has something to point at. */
  function addSource(id = 'drums-1', label = 'Drums 1'): void {
    new ChannelStrip(ctx, ctx.destination, fx, { sidechain: { bus, id, label } });
  }

  function pickSource(id = 'drums-1'): void {
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
  }

  it('clears parent and appends COMP + SC subsections', () => {
    // Marked with a class: the panel's own header spans mean a bare `span`
    // selector no longer proves the stale content is gone.
    parent.innerHTML = '<span class="stale">leftover engine editor</span>';
    mount();
    expect(parent.querySelector('.lane-fx-comp')).toBeTruthy();
    expect(parent.querySelector('.lane-fx-sc')).toBeTruthy();
    expect(parent.querySelector('span.stale')).toBeNull();
    expect(parent.textContent).not.toContain('leftover');
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
    addSource();
    mount();
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain('');
    expect(opts).toContain('drums-1');
    pickSource();
    expect(strip.getSidechain()?.source).toBe('drums-1');
  });

  it('SC SRC label uses lookupLabel when provided', () => {
    addSource('drums-1', 'DRUMS');
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

  // ── Front D: the vertical-layout bug ────────────────────────────────────
  describe('sidechain knob layout', () => {
    it('lays the DEPTH/ATK/REL box out as a row, not a column', () => {
      // The bug: the box had no display of its own, so its .knob children
      // (display:flex;flex-direction:column) stacked as blocks inside the
      // .knob-row → a vertical module. The row layout must be declared for the
      // container, and jsdom never applies our SCSS, so pin it there.
      mount();
      const box = parent.querySelector('.lane-fx-sc-knobs') as HTMLElement;
      expect(box).toBeTruthy();
      const block = scssBlock(FX_SCSS, '.lane-fx-sc-knobs');
      expect(block).toBeTruthy();
      expect(block!).toMatch(/display:\s*flex/);
      expect(block!).toMatch(/flex-direction:\s*row/);
      expect(block!).toMatch(/align-items:\s*flex-end/);
    });

    it('hides the box with the hidden attribute, not an inline display style', () => {
      mount();
      const box = parent.querySelector('.lane-fx-sc-knobs') as HTMLElement;
      // No inline style at all: lit must not be fighting a hand-written
      // `display:none` that would also defeat the row layout above.
      expect(box.getAttribute('style')).toBeNull();
      expect(box.hidden).toBe(true);
      // …and the stylesheet has to beat its own `display:flex` when hidden.
      expect(scssBlock(FX_SCSS, '.lane-fx-sc-knobs')!).toMatch(/\[hidden\][^}]*display:\s*none/);
    });

    it('reveals the box once a source is picked', () => {
      addSource();
      mount();
      expect((parent.querySelector('.lane-fx-sc-knobs') as HTMLElement).hidden).toBe(true);
      pickSource();
      expect((parent.querySelector('.lane-fx-sc-knobs') as HTMLElement).hidden).toBe(false);
    });
  });

  // ── Front D: discoverability ────────────────────────────────────────────
  describe('discoverability', () => {
    it('names both sections in plain language', () => {
      mount();
      const comp = parent.querySelector('.lane-fx-comp')!;
      expect(comp.querySelector('.lane-fx-title')!.textContent).toBe('COMP');
      expect(comp.querySelector('.lane-fx-sub')!.textContent).toContain('channel compressor');
      const sc = parent.querySelector('.lane-fx-sc')!;
      expect(sc.querySelector('.lane-fx-title')!.textContent).toBe('SIDECHAIN');
      expect(sc.querySelector('.lane-fx-sub')!.textContent).toContain('duck this lane');
    });

    it('spells out the live sidechain state next to the source select', () => {
      addSource();
      mount();
      const state = () => parent.querySelector('.lane-fx-sc-state')!.textContent!;
      expect(state()).toBe('off');
      pickSource();
      expect(state()).toContain('Drums 1');
      expect(state()).toContain('60%');
    });

    it('keeps the state text in step with the DEPTH knob', () => {
      addSource();
      mount();
      pickSource();
      const depth = registered.find((k) => k.meta.id === 'tb-303-1.fx.sc.depth')!;
      depth.setValue(0.25);
      expect(parent.querySelector('.lane-fx-sc-state')!.textContent).toContain('25%');
    });

    it('gives each section a ? button whose popover explains it without jargon', () => {
      mount();
      const btns = parent.querySelectorAll<HTMLButtonElement>('.editor-help-btn');
      const pops = parent.querySelectorAll<HTMLElement>('.editor-help-popover');
      expect(btns.length).toBe(2);
      expect(pops.length).toBe(2);
      expect(pops[0].hidden).toBe(true);
      btns[0].click();
      expect(pops[0].hidden).toBe(false);
      const compLegend = pops[0].textContent!.toLowerCase();
      expect(compLegend).toContain('threshold');
      expect(compLegend).toContain('mkup');
      const scLegend = pops[1].textContent!.toLowerCase();
      expect(scLegend).toContain('kick');
      expect(scLegend).toContain('depth');
    });

    it('keeps an open popover open across a repaint', () => {
      mount();
      const pop = parent.querySelector<HTMLElement>('.editor-help-popover')!;
      parent.querySelector<HTMLButtonElement>('.editor-help-btn')!.click();
      expect(pop.hidden).toBe(false);
      (parent.querySelector('.lane-fx-bypass') as HTMLButtonElement).click(); // repaints
      expect(parent.querySelector('.editor-help-popover')).toBe(pop);
      expect(pop.hidden).toBe(false);
    });

    it('titles all nine knobs with their meaning and unit', () => {
      addSource();
      mount();
      const knobs = Array.from(parent.querySelectorAll<HTMLElement>('.knob'));
      expect(knobs.length).toBe(9);
      for (const k of knobs) expect(k.title.length).toBeGreaterThan(20);
      const titleOf = (section: string, label: string) =>
        Array.from(parent.querySelectorAll<HTMLElement>(`${section} .knob`))
          .find((k) => k.querySelector('.knob-label')?.textContent === label)!.title;
      expect(titleOf('.lane-fx-comp', 'THR')).toContain('dB');
      expect(titleOf('.lane-fx-comp', 'ATK')).toContain('ms');
      expect(titleOf('.lane-fx-sc', 'DEPTH')).toContain('%');
      expect(titleOf('.lane-fx-sc', 'REL')).toContain('ms');
      expect((parent.querySelector('.lane-fx-bypass') as HTMLElement).title.length)
        .toBeGreaterThan(20);
      expect((parent.querySelector('.lane-fx-sc-src') as HTMLElement).title.length)
        .toBeGreaterThan(20);
    });
  });

  // ── Front D: gain-reduction meter ───────────────────────────────────────
  describe('gain-reduction meter', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sits in the COMP row and samples gain reduction off the strip', async () => {
      const spy = vi.spyOn(strip, 'getCompReduction');
      mount();
      expect(parent.querySelector('.lane-fx-comp .knob-row .gr-meter')).toBeTruthy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('survives a repaint without being rebuilt', () => {
      mount();
      const meter = parent.querySelector('.gr-meter');
      (parent.querySelector('.lane-fx-bypass') as HTMLButtonElement).click();
      expect(parent.querySelector('.gr-meter')).toBe(meter);
    });

    it('cancels the previous meter frame loop when the panel is remounted', () => {
      const caf = vi.spyOn(globalThis, 'cancelAnimationFrame');
      mount();
      const before = caf.mock.calls.length;
      registered.length = 0;
      mount(); // engine switch / lane switch remounts the panel
      expect(caf.mock.calls.length).toBeGreaterThan(before);
      caf.mockRestore();
    });

    it('cancels the old meter when the active lane moves to another PAGE', () => {
      // knob-mounting resolves a PER-PAGE container (`[data-page="303|drums|poly"]
      // .lane-fx-knobs` — index.html has one per page), so moving the active lane
      // from the 303 page to a poly lane mounts this panel into a DIFFERENT
      // container. mountPanel keys its cleanup slot on the container, so that slot
      // starts empty there and cannot reclaim the previous page's frame loop.
      // The meter's self-park backstop cannot cover it either: a hidden page is
      // `display:none`, still CONNECTED, so the loop never notices.
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      }));
      const caf = vi.fn();
      vi.stubGlobal('cancelAnimationFrame', caf);

      const pageA = document.createElement('div');
      const pageB = document.createElement('div');
      document.body.append(pageA, pageB);       // both stay connected, like real pages
      const stripB = new ChannelStrip(ctx, ctx.destination, fx, {
        sidechain: { bus, id: 'subtractive-1', label: 'Poly 1' },
      });
      const readsA = vi.spyOn(strip, 'getCompReduction');
      const readsB = vi.spyOn(stripB, 'getCompReduction');
      const noop = () => {};

      mountLaneFxPanel({ laneId: 'tb-303-1', strip, bus, parent: pageA, registerKnob: noop });
      frames.shift()!(0);                        // one frame while the 303 page is up
      const onA = readsA.mock.calls.length;
      expect(onA).toBeGreaterThan(0);

      mountLaneFxPanel({
        laneId: 'subtractive-1', strip: stripB, bus, parent: pageB, registerKnob: noop,
      });
      expect(caf).toHaveBeenCalled();            // page A's pending frame was cancelled

      // Drain every queued frame: A's must be inert, B's must keep metering.
      for (const f of frames.splice(0)) f(0);
      expect(readsA.mock.calls.length).toBe(onA);
      expect(readsB.mock.calls.length).toBeGreaterThan(0);

      readsA.mockRestore();
      readsB.mockRestore();
      pageA.remove();
      pageB.remove();
    });
  });
});

describe('sidechainSummary', () => {
  const label = (id: string) => (id === 'drums-1' ? 'Drums 1' : id);

  it('reads "off" with no source wired', () => {
    expect(sidechainSummary(null, label)).toBe('off');
    expect(sidechainSummary({ source: '', depth: 0.6, attack: 0.005, release: 0.25, threshold: -40 }, label))
      .toBe('off');
  });

  it('names the source and how deep it ducks', () => {
    const out = sidechainSummary(
      { source: 'drums-1', depth: 0.6, attack: 0.005, release: 0.25, threshold: -40 }, label);
    expect(out).toContain('Drums 1');
    expect(out).toContain('60%');
    expect(out).toContain('duck');
  });
});
