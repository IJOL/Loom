// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGrMeter, grFillFraction, GR_FLOOR_DB } from './gr-meter';

/** Fill height as a number of percent, read off the inline style the meter writes. */
function fillPct(el: HTMLElement): number {
  const fill = el.querySelector('.gr-meter-fill') as HTMLElement;
  return parseFloat(fill.style.height);
}

/** A stand-in for ChannelStrip: the meter only needs getCompReduction(). */
function fakeStrip(read: () => number) {
  return { getCompReduction: read };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('grFillFraction', () => {
  it('is empty with no reduction and fuller the deeper the compressor pulls', () => {
    expect(grFillFraction(0)).toBe(0);
    expect(grFillFraction(-12)).toBeGreaterThan(grFillFraction(-3));
    expect(grFillFraction(-3)).toBeGreaterThan(grFillFraction(0));
  });

  it('saturates at the floor instead of overflowing', () => {
    expect(grFillFraction(GR_FLOOR_DB)).toBe(1);
    expect(grFillFraction(GR_FLOOR_DB * 3)).toBe(grFillFraction(GR_FLOOR_DB));
  });

  it('reads as empty when the source cannot report a number', () => {
    // node-web-audio-api / a bypassed block may hand back NaN or undefined.
    expect(grFillFraction(NaN)).toBe(0);
    expect(grFillFraction(undefined as unknown as number)).toBe(0);
  });
});

describe('createGrMeter', () => {
  it('renders a deeper fill for -12 dB than for -3 dB', () => {
    let db = -3;
    const m = createGrMeter({ source: fakeStrip(() => db) });
    m.sample();
    const light = fillPct(m.el);
    db = -12;
    m.sample();
    const heavy = fillPct(m.el);
    expect(heavy).toBeGreaterThan(light);
    expect(light).toBeGreaterThan(0);
    m.dispose();
  });

  it('reads empty while the compressor is not compressing', () => {
    const m = createGrMeter({ source: fakeStrip(() => 0) });
    m.sample();
    expect(fillPct(m.el)).toBe(0);
    expect(m.el.classList.contains('active')).toBe(false);
    m.dispose();
  });

  it('marks itself active while compressing, so it reads at a glance', () => {
    let db = 0;
    const m = createGrMeter({ source: fakeStrip(() => db) });
    m.sample();
    expect(m.el.classList.contains('active')).toBe(false);
    db = -6;
    m.sample();
    expect(m.el.classList.contains('active')).toBe(true);
    m.dispose();
  });

  it('carries a native tooltip so the bar explains itself', () => {
    const m = createGrMeter({ source: fakeStrip(() => 0) });
    expect(m.el.title.length).toBeGreaterThan(20);
    m.dispose();
  });

  it('samples on animation frames and dispose() cancels the pending one', () => {
    const frames: FrameRequestCallback[] = [];
    const ids: number[] = [];
    let nextId = 1;
    const raf = vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      const id = nextId++;
      ids.push(id);
      return id;
    });
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);

    let reads = 0;
    const m = createGrMeter({ source: fakeStrip(() => { reads++; return -6; }) });
    expect(raf).toHaveBeenCalledTimes(1);

    frames.shift()!(0);                       // run one frame
    const readsAfterFrame = reads;
    expect(readsAfterFrame).toBeGreaterThan(0);
    expect(raf).toHaveBeenCalledTimes(2);     // the loop re-armed itself

    const pending = ids[ids.length - 1];
    m.dispose();
    expect(caf).toHaveBeenCalledTimes(1);
    expect(caf).toHaveBeenCalledWith(pending);

    // A frame already in flight when dispose() landed must be inert: no further
    // reads of a strip that is no longer on screen, and no re-arming.
    frames.shift()!(0);
    expect(reads).toBe(readsAfterFrame);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('parks itself once it has been on the page and is taken off it', () => {
    // The backstop for a panel whose container is wiped and never remounted:
    // nothing would call dispose(), so the loop has to notice on its own.
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);

    let reads = 0;
    const m = createGrMeter({ source: fakeStrip(() => { reads++; return -6; }) });
    document.body.appendChild(m.el);
    frames.shift()!(0);                       // a frame while on the page
    const readsOnPage = reads;
    expect(readsOnPage).toBeGreaterThan(0);
    expect(raf).toHaveBeenCalledTimes(2);     // still looping

    m.el.remove();                            // container wiped by someone else
    frames.shift()!(0);
    expect(caf).toHaveBeenCalledTimes(1);     // parked itself
    expect(reads).toBe(readsOnPage);          // and stopped reading the strip
    expect(raf).toHaveBeenCalledTimes(2);     // no re-arm
  });

  it('keeps sampling while deliberately detached (offscreen build)', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let reads = 0;
    const m = createGrMeter({ source: fakeStrip(() => { reads++; return -6; }) });
    frames.shift()!(0);
    frames.shift()!(0);
    expect(reads).toBeGreaterThan(1);
    m.dispose();
  });

  it('dispose() empties the bar and leaves the element where the panel put it', () => {
    // The owning panel owns this element (lit interpolates it), and a panel can be
    // disposed while still on a hidden page. So dispose() must not yank the node
    // out from under lit — and a parked bar must read EMPTY, never keep a stale
    // reduction on screen (same lie CompBlock.getReduction() refuses to tell).
    let db = -12;
    const m = createGrMeter({ source: fakeStrip(() => db) });
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.appendChild(m.el);
    m.sample();
    const compressing = fillPct(m.el);
    expect(compressing).toBeGreaterThan(0);

    m.dispose();

    expect(m.el.parentElement).toBe(host);
    expect(fillPct(m.el)).toBeLessThan(compressing);
    expect(fillPct(m.el)).toBe(0);
    expect(m.el.classList.contains('active')).toBe(false);
    // …and it stays empty: a disposed meter never samples again.
    db = -24;
    m.sample();
    expect(fillPct(m.el)).toBe(0);
    host.remove();
  });

  it('dispose() is idempotent', () => {
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7));
    vi.stubGlobal('cancelAnimationFrame', caf);
    const m = createGrMeter({ source: fakeStrip(() => 0) });
    m.dispose();
    m.dispose();
    expect(caf).toHaveBeenCalledTimes(1);
  });
});
