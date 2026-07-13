// Node test env has no KeyboardEvent/HTMLElement/document (vitest.config.ts:5,
// environment: 'node'); Event/EventTarget ARE node globals, so we build events
// by hand and inject a bare EventTarget as `deps.target`.
import { describe, it, expect, vi } from 'vitest';
import { attachComputerKeyboard } from './computer-keyboard';
import { DEFAULT_VELOCITY } from '../core/velocity-gain';

function key(target: EventTarget, type: 'keydown' | 'keyup', k: string, extra: Record<string, unknown> = {}) {
  const ev = new Event(type, { cancelable: true });
  Object.assign(ev, { key: k, repeat: false, ...extra });
  target.dispatchEvent(ev);
  return ev;
}

function harness(o: {
  enabled?: boolean; lane?: string | null;
  getOctaveBase?: () => number | null; onOctaveChange?: (b: number) => void;
} = {}) {
  const facade = { playLiveNote: vi.fn(), releaseLiveNote: vi.fn() };
  const target = new EventTarget();
  let enabled = o.enabled ?? true;
  attachComputerKeyboard({
    facade,
    getActiveLane: () => (o.lane === undefined ? 'lane-1' : o.lane),
    isEnabled: () => enabled,
    target,
    initialOctaveBase: 60,
    getOctaveBase: o.getOctaveBase,
    onOctaveChange: o.onOctaveChange,
  });
  return {
    facade,
    key: (type: 'keydown' | 'keyup', k: string, extra: Record<string, unknown> = {}) => key(target, type, k, extra),
    blur: () => target.dispatchEvent(new Event('blur')),
    setEnabled: (v: boolean) => { enabled = v; },
  };
}

describe('attachComputerKeyboard', () => {
  it('a musical keydown plays the active lane with DEFAULT_VELOCITY; keyup releases the same note', () => {
    const h = harness();
    h.key('keydown', 'a');
    expect(h.facade.playLiveNote).toHaveBeenCalledTimes(1);
    const [lane, midi, vel] = h.facade.playLiveNote.mock.calls[0];
    expect(lane).toBe('lane-1');
    expect(vel).toBe(DEFAULT_VELOCITY);
    h.key('keyup', 'a');
    expect(h.facade.releaseLiveNote).toHaveBeenCalledWith('lane-1', midi);
  });

  it('does nothing when disabled', () => {
    const h = harness({ enabled: false });
    h.key('keydown', 'a');
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('ignores auto-repeat and re-press while held (one voice per physical key)', () => {
    const h = harness();
    h.key('keydown', 'a');
    h.key('keydown', 'a', { repeat: true });
    h.key('keydown', 'a'); // still held → no retrigger
    expect(h.facade.playLiveNote).toHaveBeenCalledTimes(1);
  });

  it('lets editing shortcuts through: Ctrl/Meta combos never play', () => {
    const h = harness();
    h.key('keydown', 'a', { ctrlKey: true });
    h.key('keydown', 'c', { metaKey: true });
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('z / x shift the octave down / up by 12 semitones', () => {
    const h = harness();
    h.key('keydown', 'a');
    const baseMidi = h.facade.playLiveNote.mock.calls[0][1];
    h.key('keyup', 'a');
    h.key('keydown', 'x'); // octave up
    h.key('keydown', 'a');
    const upMidi = h.facade.playLiveNote.mock.calls[1][1];
    expect(upMidi).toBe(baseMidi + 12);
  });

  it('shares the octave with an open editor: z/x step from getOctaveBase() and report via onOctaveChange', () => {
    const onOctaveChange = vi.fn();
    // The piano-roll display shows C5 (72); our local base is still 60.
    const h = harness({ getOctaveBase: () => 72, onOctaveChange });
    h.key('keydown', 'x'); // steps from the EDITOR octave (72), not local (60)
    expect(onOctaveChange).toHaveBeenCalledWith(84); // C5 → C6
    h.key('keydown', 'z');
    expect(onOctaveChange).toHaveBeenLastCalledWith(60); // C5 → C4 (getter is constant 72)
  });

  it('non-note keys (arrows, digits) never play', () => {
    const h = harness();
    h.key('keydown', 'ArrowLeft');
    h.key('keydown', '1');
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('no active lane → no-op', () => {
    const h = harness({ lane: null });
    h.key('keydown', 'a');
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('toggled off mid-hold still releases on keyup (no stuck note)', () => {
    const h = harness();
    h.key('keydown', 'a');
    h.setEnabled(false);
    h.key('keyup', 'a');
    expect(h.facade.releaseLiveNote).toHaveBeenCalledTimes(1);
  });

  it('keyup after an octave shift releases the ORIGINAL note, not the shifted one', () => {
    const h = harness();
    h.key('keydown', 'a');
    const played = h.facade.playLiveNote.mock.calls[0][1];
    h.key('keydown', 'x');          // octave up (does not release the held 'a')
    h.key('keyup', 'a');
    expect(h.facade.releaseLiveNote).toHaveBeenCalledWith('lane-1', played); // NOT played + 12
  });

  it('window blur releases every held note and lets the key retrigger afterwards', () => {
    const h = harness();
    h.key('keydown', 'a');
    const played = h.facade.playLiveNote.mock.calls[0][1];
    h.blur();                        // focus lost while 'a' is held
    expect(h.facade.releaseLiveNote).toHaveBeenCalledWith('lane-1', played);
    // held was cleared, so pressing 'a' again plays again (not blocked by a stale held entry)
    h.key('keydown', 'a');
    expect(h.facade.playLiveNote).toHaveBeenCalledTimes(2);
  });
});
