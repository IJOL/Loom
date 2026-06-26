import { describe, it, expect } from 'vitest';
import { ScheduledNoteOffs } from './scheduled-noteoffs';

/** A fake voice recording the times it was note-off'd at. */
function fakeVoice() {
  const offs: number[] = [];
  return { offs, noteOff(t: number) { this.offs.push(t); } };
}

const SR = 48000;

describe('ScheduledNoteOffs', () => {
  it('does NOT note-off before the scheduled frame is reached', () => {
    const s = new ScheduledNoteOffs<ReturnType<typeof fakeVoice>>();
    const v = fakeVoice();
    s.schedule(SR /* = 1.0s */, [v]);
    s.drainDue(SR - 1, SR); // one frame early
    expect(v.offs).toEqual([]);
  });

  it('note-offs every scheduled voice AT the scheduled time when the frame arrives', () => {
    const s = new ScheduledNoteOffs<ReturnType<typeof fakeVoice>>();
    const a = fakeVoice(), b = fakeVoice();
    s.schedule(SR, [a, b]); // frame = 1.0s worth of frames
    s.drainDue(SR, SR);
    expect(a.offs).toEqual([1.0]);
    expect(b.offs).toEqual([1.0]);
  });

  it('uses the SCHEDULED frame time (T), not the current frame, for the note-off', () => {
    const s = new ScheduledNoteOffs<ReturnType<typeof fakeVoice>>();
    const v = fakeVoice();
    s.schedule(SR, [v]);          // T = 1.0s
    s.drainDue(SR + 4800, SR);    // drained 100ms late, but note-off must still be at T
    expect(v.offs).toEqual([1.0]);
  });

  it('drains only the due group, leaving future ones pending', () => {
    const s = new ScheduledNoteOffs<ReturnType<typeof fakeVoice>>();
    const now = fakeVoice(), later = fakeVoice();
    s.schedule(SR, [now]);        // T = 1.0s
    s.schedule(2 * SR, [later]);  // T = 2.0s
    s.drainDue(SR, SR);
    expect(now.offs).toEqual([1.0]);
    expect(later.offs).toEqual([]);
    s.drainDue(2 * SR, SR);
    expect(later.offs).toEqual([2.0]);
  });

  it('never note-offs the same group twice (removed once fired)', () => {
    const s = new ScheduledNoteOffs<ReturnType<typeof fakeVoice>>();
    const v = fakeVoice();
    s.schedule(SR, [v]);
    s.drainDue(SR, SR);
    s.drainDue(SR + 1000, SR);
    expect(v.offs).toEqual([1.0]);
  });

  it('reports pending state so the processor can skip the drain loop when idle', () => {
    const s = new ScheduledNoteOffs<ReturnType<typeof fakeVoice>>();
    expect(s.isEmpty()).toBe(true);
    s.schedule(SR, [fakeVoice()]);
    expect(s.isEmpty()).toBe(false);
    s.drainDue(SR, SR);
    expect(s.isEmpty()).toBe(true);
  });
});
