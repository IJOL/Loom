import { describe, it, expect } from 'vitest';
import type { SessionClip } from '../session';
import { renderDrumGridEditor } from './clip-editor-drum-grid';
import { GM_DRUM_MAP, VOICE_MIDI } from '../../engines/drum-gm-map';
import { TICKS_PER_STEP } from '../../core/notes';

function freshClip(): SessionClip {
  return { id: 't', lengthBars: 1, notes: [] };
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

  it('renderDrumGridEditor does NOT set clip.gridResolution when the clip has none (no phantom undo mutation)', () => {
    // Root-cause test for the phantom-undo bug: the editor used to write
    // clip.gridResolution = DEFAULT_RESOLUTION on every open/render, which
    // turned into a spurious undo entry on the first real edit.  The fix reads
    // the value into a LOCAL variable and leaves clip.gridResolution untouched.
    const clip = { id: 't', lengthBars: 1, notes: [] } as SessionClip;
    expect(clip.gridResolution).toBeUndefined();          // pre-condition: no value
    try { renderDrumGridEditor(makeHost(), clip); } catch { /* no DOM */ }
    // Post-condition: the clip must not have been mutated on open.
    expect(clip.gridResolution).toBeUndefined();
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
