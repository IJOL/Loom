import { describe, it, expect, vi } from 'vitest';
import { wireTransport, type TransportDeps } from './transport';

/** A fake play button that captures the click listener so a test can fire it. */
function fakeButton() {
  let clickHandler: (() => void) | null = null;
  const el = {
    textContent: '',
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'click') clickHandler = fn;
    },
  } as unknown as HTMLButtonElement;
  return { el, click: () => clickHandler?.() };
}

describe('wireTransport Play/Stop button', () => {
  function setup() {
    let playing = false;
    const seq = {
      isPlaying: () => playing,
      start: vi.fn(() => { playing = true; }),
      stop: vi.fn(() => { playing = false; }),
    } as unknown as TransportDeps['seq'];
    const ctx = { resume: () => Promise.resolve() } as unknown as AudioContext;
    const btn = fakeButton();
    // The unified stop now owns stopping the clock AND resetting the glyph (so
    // the live-take finalize, lane stop, glyph reset, and re-render are a single
    // source of truth in main's stopTransport). wireTransport just delegates to
    // it on the stop click — it no longer touches seq.stop()/the glyph itself.
    const onStop = vi.fn(() => { seq.stop(); btn.el.textContent = '▶'; });
    const resetAutomationPosition = vi.fn();
    wireTransport({ seq, ctx, playBtn: btn.el, resetAutomationPosition, onStop });
    return { seq, btn, onStop, resetAutomationPosition };
  }

  it('starting does not invoke onStop and shows the stop glyph', () => {
    const { btn, onStop } = setup();
    btn.click(); // start
    expect(btn.el.textContent).toBe('■');
    expect(onStop).not.toHaveBeenCalled();
  });

  it('stopping delegates to onStop (the unified stop), which clears the glyph', () => {
    const { seq, btn, onStop } = setup();
    btn.click(); // start
    btn.click(); // stop → delegates entirely to onStop
    expect(onStop).toHaveBeenCalledTimes(1);
    // The glyph reset and clock stop come from onStop, not wireTransport.
    expect(btn.el.textContent).toBe('▶');
    expect(seq.stop).toHaveBeenCalledTimes(1);
  });
});
