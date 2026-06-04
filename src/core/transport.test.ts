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
    const onStop = vi.fn();
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

  it('stopping invokes onStop (so lanes stop + playheads clear) and shows the play glyph', () => {
    const { btn, onStop } = setup();
    btn.click(); // start
    btn.click(); // stop
    expect(btn.el.textContent).toBe('▶');
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
