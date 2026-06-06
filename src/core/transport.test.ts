import { describe, it, expect, vi } from 'vitest';
import { wireTransport, setPlaying, type TransportDeps } from './transport';

/** A fake button that captures its click listener and tracks classList. */
function fakeButton() {
  let clickHandler: (() => void) | null = null;
  const classes = new Set<string>();
  const el = {
    classList: {
      add: (c: string) => { classes.add(c); },
      remove: (c: string) => { classes.delete(c); },
      toggle: (c: string, on?: boolean) => {
        const want = on === undefined ? !classes.has(c) : on;
        if (want) classes.add(c); else classes.delete(c);
      },
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'click') clickHandler = fn;
    },
  } as unknown as HTMLButtonElement;
  return { el, click: () => clickHandler?.(), hasClass: (c: string) => classes.has(c) };
}

describe('wireTransport — separate Play and Stop buttons', () => {
  function setup() {
    let playing = false;
    const seq = {
      isPlaying: () => playing,
      start: vi.fn(() => { playing = true; }),
      stop: vi.fn(() => { playing = false; }),
    } as unknown as TransportDeps['seq'];
    const ctx = { resume: () => Promise.resolve() } as unknown as AudioContext;
    const play = fakeButton();
    const stop = fakeButton();
    // Unified stop owns the actual clock stop + clearing the playing state.
    const onStop = vi.fn(() => { seq.stop(); setPlaying(play.el, false); });
    const resetAutomationPosition = vi.fn();
    wireTransport({ seq, ctx, playBtn: play.el, stopBtn: stop.el, resetAutomationPosition, onStop });
    return { seq, play, stop, onStop, resetAutomationPosition };
  }

  it('Play starts the transport, marks it playing, and never calls onStop', () => {
    const { play, seq, onStop } = setup();
    play.click();
    expect(seq.start).toHaveBeenCalledTimes(1);
    expect(play.hasClass('is-playing')).toBe(true);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Play while already running is a no-op (never stops)', () => {
    const { play, seq, onStop } = setup();
    play.click(); // start
    play.click(); // again — should NOT restart or stop
    expect(seq.start).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Stop delegates to onStop, which clears the playing state', () => {
    const { play, stop, seq, onStop } = setup();
    play.click(); // start
    stop.click(); // stop
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(seq.stop).toHaveBeenCalledTimes(1);
    expect(play.hasClass('is-playing')).toBe(false);
  });

  it('Stop while idle is a no-op (never starts)', () => {
    const { stop, seq, onStop } = setup();
    stop.click();
    expect(onStop).not.toHaveBeenCalled();
    expect(seq.start).not.toHaveBeenCalled();
  });
});
