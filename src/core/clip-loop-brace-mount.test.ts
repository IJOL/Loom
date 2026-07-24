// @vitest-environment jsdom
// Characterisation tests for mountClipLoopBrace's DOM contract (the pure math
// is covered in clip-loop-brace.test.ts). Pinned during the lit-html migration:
// exact class names + insert-as-first-child + the toggle's gesture wrapping.
import { describe, it, expect, vi } from 'vitest';
import { mountClipLoopBrace } from './clip-loop-brace';
import type { SessionClip } from '../session/session';
import type { TimeSignature } from './meter';

const METER: TimeSignature = { num: 4, den: 4 }; // 384 ticks/bar

function mkClip(): SessionClip {
  return { id: 'c1', lengthBars: 2, notes: [] } as unknown as SessionClip;
}

describe('mountClipLoopBrace', () => {
  it('mounts the strip as the FIRST child of the host with the contract classes', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="editor"></div>'; // pre-existing editor content
    mountClipLoopBrace(host, mkClip(), METER, undefined, () => {});

    const strip = host.firstElementChild!;
    expect(strip.className).toBe('clip-loop-brace');
    const toggle = strip.querySelector('button.clip-loop-toggle')!;
    expect(toggle.textContent).toBe('Loop');
    expect(toggle.classList.contains('on')).toBe(false);
    const region = strip.querySelector('.clip-loop-track > .clip-loop-region')!;
    expect(region).not.toBeNull();
    expect(region.querySelector('.clip-loop-handle.l')).not.toBeNull();
    expect(region.querySelector('.clip-loop-handle.r')).not.toBeNull();
  });

  it('toggle click seeds + enables the loop inside a history gesture, then fires onChange', () => {
    const host = document.createElement('div');
    const clip = mkClip();
    const calls: string[] = [];
    const historyDeps = {
      beginGesture: () => calls.push('begin'),
      endGesture: () => calls.push('end'),
    } as never;
    const onChange = vi.fn(() => calls.push('change'));
    mountClipLoopBrace(host, clip, METER, historyDeps, onChange);

    (host.querySelector('.clip-loop-toggle') as HTMLButtonElement).click();
    expect(clip.loopEnabled).toBe(true);
    expect(clip.loopStartTick).toBe(0);
    expect(clip.loopEndTick).toBe(768); // 2 bars of 4/4
    expect(calls).toEqual(['begin', 'end', 'change']);
    // layout() ran on the click: the toggle pill lights up
    expect(host.querySelector('.clip-loop-toggle')!.classList.contains('on')).toBe(true);
  });
});
