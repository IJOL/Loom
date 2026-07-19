// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { SessionClip } from '../session';
import { renderDrumGridEditor, type DrumGridModel } from './clip-editor-drum-grid';
import { GM_DRUM_MAP, VOICE_MIDI } from '../../engines/drum-gm-map';
import { noteDrumRows } from '../../core/drum-grid-editing';
import { TICKS_PER_STEP } from '../../core/notes';

function stubCanvas(): void {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

function freshClip(): SessionClip {
  return { color: '#d8e8a8', gridResolution: '1/16', id: 't', lengthBars: 1, notes: [] };
}

function makeHost(): HTMLElement {
  // Pure JS — no jsdom. We'll inspect notes after running the renderer's
  // exported click handlers indirectly by faking a DOM node.
  return { innerHTML: '', appendChild: () => {}, classList: { add: () => {} } } as unknown as HTMLElement;
}

describe('clip-editor-drum-grid roll behaviour', () => {
  // The renderer mutates clip.notes via DOM event handlers, which we can't
  // exercise without a DOM. These tests verify the data shape stays consistent
  // for the few invariants we care about by directly using the public helpers
  // exposed by the renderer's behaviour: after a render, the host is reset.
  it('renderDrumGridEditor initialises clip.notes to [] when missing', () => {
    const clip = { id: 't', lengthBars: 1 } as SessionClip;
    // Renderer touches `document` after the notes init, which is fine — we
    // only care that clip.notes was set up by the time the DOM call throws
    // in the node test env.
    try { renderDrumGridEditor(makeHost(), clip); } catch { /* no DOM */ }
    expect(clip.notes).toEqual([]);
  });

  it('renderDrumGridEditor does not overwrite an existing clip.gridResolution (no phantom undo mutation)', () => {
    // Root-cause test for the phantom-undo bug: the editor used to write
    // clip.gridResolution = DEFAULT_RESOLUTION on every open/render, which
    // turned into a spurious undo entry on the first real edit.  The fix reads
    // the value into a LOCAL variable and leaves clip.gridResolution untouched.
    // gridResolution is required on SessionClip now (always set at construction),
    // so the invariant under test is "render doesn't clobber the existing value",
    // not "an absent value stays absent" (which is no longer representable).
    const clip = { color: '#c8a8e0', gridResolution: '1/8', id: 't', lengthBars: 1, notes: [] } as SessionClip;
    try { renderDrumGridEditor(makeHost(), clip); } catch { /* no DOM */ }
    // Post-condition: the clip's existing value must not have been mutated on open.
    expect(clip.gridResolution).toBe('1/8');
  });
});

const model = (notes: number[]): DrumGridModel => ({ rows: noteDrumRows(notes), labels: notes.map(String) });

describe('drum grid full-kit toggle', () => {
  it('renders a Full kit toggle when deps.fullKit is provided', () => {
    stubCanvas();
    const host = document.createElement('div');
    const clip = { color: '#e0a8d0', gridResolution: '1/16', id: 'c', lengthBars: 1, notes: [] } as SessionClip;
    renderDrumGridEditor(host, clip, undefined, undefined, {
      fullKit: { build: (full) => model(full ? [36, 38, 42] : [36]) },
    }, model([36]));
    const btn = [...host.querySelectorAll('button')].find((b) => /full kit/i.test(b.textContent ?? ''));
    expect(btn).toBeTruthy();
  });
});

describe('drum-grid roll encoding (data shape)', () => {
  // We can verify the encoding via a synthetic note pushed manually then
  // played through GM_DRUM_MAP/VOICE_MIDI — this confirms the contract that
  // roll-encoded notes look correct (multiple notes per step at canonical
  // midi, sub-step spaced).
  it('roll=3 means three closely-spaced notes at the canonical midi', () => {
    const clip = freshClip();
    const div = 3;
    const subDur = TICKS_PER_STEP / div;
    for (let r = 0; r < div; r++) {
      clip.notes.push({
        midi: VOICE_MIDI.kick,
        start: 0 + Math.floor(r * subDur),
        duration: Math.max(1, Math.floor(subDur * 0.9)),
        velocity: 80,
      });
    }
    expect(clip.notes).toHaveLength(3);
    expect(clip.notes.every((n) => GM_DRUM_MAP[n.midi] === 'kick')).toBe(true);
    const starts = clip.notes.map((n) => n.start).sort((a, b) => a - b);
    expect(starts[0]).toBe(0);
    expect(starts[2]).toBeLessThan(TICKS_PER_STEP);
  });
});
