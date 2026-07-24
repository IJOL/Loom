// @vitest-environment jsdom
// Characterisation tests for the clip loop overlay (mount + interactions):
// pinned during the lit-html migration so the DOM contract (classes the SCSS
// and drag code target) and the callback order stay exactly as they were.
import { describe, it, expect, vi } from 'vitest';
import { mountClipLoopOverlay, type ClipLoopOverlayDeps } from './clip-loop-overlay';
import type { SessionClip } from '../session/session';
import type { TimeSignature } from './meter';

const METER: TimeSignature = { num: 4, den: 4 }; // 384 ticks/bar

function mkClip(over: Partial<SessionClip> = {}): SessionClip {
  // Only the length + loop fields are read by the overlay; avoid importing the
  // whole session module for a fixture.
  return { id: 'c1', lengthBars: 2, notes: [], ...over } as unknown as SessionClip;
}

function mkDeps(clip: SessionClip, over: Partial<ClipLoopOverlayDeps> = {}) {
  const toolbarHost = document.createElement('div');
  const scrollHost = document.createElement('div');
  document.body.append(toolbarHost, scrollHost);
  const deps: ClipLoopOverlayDeps = {
    toolbarHost, scrollHost, clip, meter: METER,
    tickToX: (t) => t * 0.5,
    tickFromClientX: (cx) => cx,
    contentHeight: () => 200,
    ...over,
  };
  return { deps, toolbarHost, scrollHost };
}

describe('mountClipLoopOverlay', () => {
  it('builds the toolbar and the overlay column with the contract classes', () => {
    const clip = mkClip();
    const { deps, toolbarHost, scrollHost } = mkDeps(clip);
    mountClipLoopOverlay(deps);

    const bar = toolbarHost.querySelector('.clip-loop-bar')!;
    expect(bar).not.toBeNull();
    const toggle = bar.querySelector('button.clip-loop-toggle')!;
    expect(toggle.textContent).toBe('Loop');
    expect(toggle.classList.contains('on')).toBe(false); // loop off initially
    const qsel = bar.querySelector('select.clip-loop-quant') as HTMLSelectElement;
    expect(qsel.title).toBe('Loop quantization');
    expect([...qsel.options].map((o) => o.value)).toEqual(['bar', 'beat', 'free']);
    expect([...qsel.options].map((o) => o.textContent)).toEqual(['Bar', 'Beat', 'Free']);
    expect(qsel.value).toBe('bar');
    // No Global button unless the host can link scenes.
    expect(bar.querySelector('.clip-loop-global')).toBeNull();

    const col = scrollHost.querySelector('.clip-loop-col')!;
    expect(col).not.toBeNull();
    // Move zone first, then the edges (edges must win at the borders).
    const kids = [...col.children].map((c) => c.className);
    expect(kids).toEqual(['clip-loop-move', 'clip-loop-edge l', 'clip-loop-edge r']);
  });

  it('Loop toggle enables the loop, seeds the full region and notifies in order', () => {
    const clip = mkClip();
    const calls: string[] = [];
    const { deps, toolbarHost } = mkDeps(clip, {
      historyDeps: {
        beginGesture: () => calls.push('begin'),
        endGesture: () => calls.push('end'),
      } as never,
      onChange: () => calls.push('change'),
      onClipLoopEdited: () => calls.push('edited'),
    });
    mountClipLoopOverlay(deps);

    const toggle = toolbarHost.querySelector('.clip-loop-toggle') as HTMLButtonElement;
    toggle.click();
    expect(clip.loopEnabled).toBe(true);
    expect(clip.loopStartTick).toBe(0);
    expect(clip.loopEndTick).toBe(768); // 2 bars of 4/4
    expect(toggle.classList.contains('on')).toBe(true);
    expect(calls).toEqual(['begin', 'end', 'change', 'edited']);
  });

  it('redraw positions the column via tickToX and hides it when the loop is off', () => {
    const clip = mkClip({ loopEnabled: true, loopStartTick: 96, loopEndTick: 480 } as Partial<SessionClip>);
    const { deps, scrollHost } = mkDeps(clip);
    const { redraw } = mountClipLoopOverlay(deps);
    const col = scrollHost.querySelector('.clip-loop-col') as HTMLElement;

    redraw();
    expect(col.style.left).toBe('48px');    // 96 · 0.5
    expect(col.style.width).toBe('192px');  // (480−96) · 0.5
    expect(col.style.height).toBe('200px');
    expect(col.style.display).toBe('');

    clip.loopEnabled = false;
    redraw();
    expect(col.style.display).toBe('none');
  });

  it('right-edge drag writes a quantized region and commits on pointerup', () => {
    const clip = mkClip({ loopEnabled: true, loopStartTick: 0, loopEndTick: 768 } as Partial<SessionClip>);
    const onChange = vi.fn();
    const onClipLoopEdited = vi.fn();
    const { deps, toolbarHost, scrollHost } = mkDeps(clip, { onChange, onClipLoopEdited });
    mountClipLoopOverlay(deps);

    const hR = scrollHost.querySelector('.clip-loop-edge.r') as HTMLElement;
    // jsdom has no PointerEvent; the handlers only read clientX, so MouseEvent
    // dispatched under the pointer* type is a faithful stand-in.
    hR.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
    // Default quantize is 'bar' (384 ticks): 400 snaps to 384.
    expect(clip.loopEndTick).toBe(384);
    expect(onChange).not.toHaveBeenCalled(); // not before commit
    window.dispatchEvent(new MouseEvent('pointerup', {}));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onClipLoopEdited).toHaveBeenCalledTimes(1);

    // Switch quantize to 'beat' (96 ticks) through the select and drag again.
    const qsel = toolbarHost.querySelector('.clip-loop-quant') as HTMLSelectElement;
    qsel.value = 'beat';
    qsel.dispatchEvent(new Event('change', { bubbles: true }));
    hR.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }));
    expect(clip.loopEndTick).toBe(96);
    window.dispatchEvent(new MouseEvent('pointerup', {}));
  });

  it('Global button reflects the linked state and toggles it', () => {
    const clip = mkClip();
    const onToggleLink = vi.fn();
    let linked = false;
    const { deps, toolbarHost } = mkDeps(clip, { isLinked: () => linked, onToggleLink });
    mountClipLoopOverlay(deps);

    const btn = toolbarHost.querySelector('button.clip-loop-global') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Global');
    expect(btn.title).toBe('Share this loop across every clip in the scene');
    expect(btn.classList.contains('on')).toBe(false);
    btn.click();
    expect(onToggleLink).toHaveBeenCalledWith(true);
    expect(btn.classList.contains('on')).toBe(true);
    linked = true; // external state now linked; a later click unlinks
    btn.click();
    expect(onToggleLink).toHaveBeenLastCalledWith(false);
    expect(btn.classList.contains('on')).toBe(false);
  });
});
