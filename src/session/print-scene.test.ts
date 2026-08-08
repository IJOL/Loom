import { describe, it, expect } from 'vitest';
import { printScene } from './session-runtime';
import { clipRowCount } from './session';
import type { SessionState } from './session';
import type { NoteEvent } from '../core/notes';

const note = (start: number, midi: number): NoteEvent =>
  ({ start, duration: 12, midi, velocity: 100 });

function session(): SessionState {
  return {
    name: 'T', masterInserts: [], sends: [], globalQuantize: 'immediate',
    musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false },
    lanes: [
      { id: 'lane1', engineId: 'subtractive', inserts: [], clips: [null] },
      { id: 'lane2', engineId: 'subtractive', inserts: [], clips: [null] },
    ],
    scenes: [{ id: 's1', name: 'Scene 1', clipPerLane: {} }],
  } as unknown as SessionState;
}

describe('printScene', () => {
  it('writes the notes it is given into a NEW bottom row', () => {
    const s = session();
    const before = clipRowCount(s);
    printScene(s, new Map([['lane1', [note(0, 36)]]]), 'Weave');

    expect(clipRowCount(s)).toBe(before + 1);
    expect(s.lanes[0].clips[before]?.notes.map((n) => n.midi)).toEqual([36]);
  });

  it('gives a lane with nothing to print an EMPTY slot, not a silent clip', () => {
    // The new scene should read as "these lanes were weaving", not as
    // "everything, some of it mute".
    const s = session();
    const row = clipRowCount(s);
    printScene(s, new Map([['lane1', [note(0, 36)]]]), 'Weave');
    expect(s.lanes[1].clips[row] ?? null).toBeNull();
  });

  it('adds a launchable scene, named', () => {
    const s = session();
    const row = clipRowCount(s);
    expect(printScene(s, new Map([['lane1', [note(0, 36)]]]), 'Weave')).toBe(s.scenes[row]);
    expect(s.scenes[row].name).toBe('Weave');
  });

  it('COPIES the notes, so the weave can keep folding', () => {
    // A printed clip that shared the weave's array would keep changing under
    // the user, which is the opposite of what printing is for.
    const s = session();
    const live = [note(0, 36)];
    const row = clipRowCount(s);
    printScene(s, new Map([['lane1', live]]), 'Weave');

    live[0].midi = 99;
    live.push(note(96, 40));
    expect(s.lanes[0].clips[row]?.notes).toHaveLength(1);
    expect(s.lanes[0].clips[row]?.notes[0].midi).toBe(36);
  });

  it('does nothing at all when nothing was weaving', () => {
    const s = session();
    const before = clipRowCount(s);
    expect(printScene(s, new Map(), 'Weave')).toBeNull();
    expect(clipRowCount(s)).toBe(before);
  });

  it('treats an empty note list as nothing to print', () => {
    const s = session();
    const before = clipRowCount(s);
    expect(printScene(s, new Map([['lane1', []]]), 'Weave')).toBeNull();
    expect(clipRowCount(s)).toBe(before);
  });

  it('prints again below the last print, rather than over it', () => {
    // Printing twice is how a user collects takes; the second must not eat the
    // first.
    const s = session();
    printScene(s, new Map([['lane1', [note(0, 36)]]]), 'Weave');
    const row2 = clipRowCount(s);
    printScene(s, new Map([['lane1', [note(0, 40)]]]), 'Weave');

    expect(s.lanes[0].clips[row2 - 1]?.notes[0].midi).toBe(36);
    expect(s.lanes[0].clips[row2]?.notes[0].midi).toBe(40);
  });

  it('pads a lane whose clips array is shorter than the new row', () => {
    // A lane added later has fewer slots, and writing past the end would leave
    // a hole that reads as `undefined` rather than an empty cell.
    const s = session();
    s.lanes[1].clips = [];
    const row = clipRowCount(s);
    printScene(s, new Map([['lane1', [note(0, 36)]], ['lane2', [note(0, 40)]]]), 'Weave');
    expect(s.lanes[1].clips).toHaveLength(row + 1);
  });
});
