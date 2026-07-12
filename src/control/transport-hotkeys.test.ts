import { describe, it, expect, vi } from 'vitest';
import { attachTransportHotkeys } from './transport-hotkeys';

function harness(o: { isText?: boolean } = {}) {
  const onTogglePlay = vi.fn();
  const onToggleRec = vi.fn();
  const target = new EventTarget();
  attachTransportHotkeys({ isTextTarget: () => o.isText ?? false, onTogglePlay, onToggleRec, target });
  const key = (k: string, extra: Record<string, unknown> = {}) => {
    const ev = new Event('keydown', { cancelable: true });
    Object.assign(ev, { key: k, ...extra });
    target.dispatchEvent(ev);
    return ev;
  };
  return { onTogglePlay, onToggleRec, key };
}

describe('attachTransportHotkeys', () => {
  it('Space toggles play and preventDefaults', () => {
    const h = harness();
    const ev = h.key(' ');
    expect(h.onTogglePlay).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('r toggles rec', () => {
    const h = harness();
    h.key('r');
    expect(h.onToggleRec).toHaveBeenCalledTimes(1);
    h.key('R');
    expect(h.onToggleRec).toHaveBeenCalledTimes(2);   // case-insensitive
  });

  it('does nothing on a text-edit target', () => {
    const h = harness({ isText: true });
    h.key(' ');
    h.key('r');
    expect(h.onTogglePlay).not.toHaveBeenCalled();
    expect(h.onToggleRec).not.toHaveBeenCalled();
  });

  it('ignores modifier combos (Ctrl+Space, Meta+R)', () => {
    const h = harness();
    h.key(' ', { ctrlKey: true });
    h.key('r', { metaKey: true });
    expect(h.onTogglePlay).not.toHaveBeenCalled();
    expect(h.onToggleRec).not.toHaveBeenCalled();
  });

  it('ignores unrelated keys', () => {
    const h = harness();
    h.key('a');
    h.key('Enter');
    expect(h.onTogglePlay).not.toHaveBeenCalled();
    expect(h.onToggleRec).not.toHaveBeenCalled();
  });
});
