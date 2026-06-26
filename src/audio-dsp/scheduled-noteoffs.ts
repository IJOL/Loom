// Future-dated note-offs for the sampler/audio worklet. A scene switch must cut
// the OUTGOING voices at the switch instant T (the governing loop end) — the SAME
// instant the incoming clip starts — so the transition is gapless. The old path
// note-off'd immediately on message receipt, which (because the scheduler posts
// the silence up to one look-ahead window BEFORE T) cut the audio early and left
// an audible hole until the new clip began at T.
//
// This holds groups of already-live voices captured at message time and fires
// their noteOff exactly when the playback frame reaches the scheduled frame.
// Pure (no worklet globals) so the scheduling logic is unit-testable.

interface Group<V> { frame: number; voices: V[]; }

export class ScheduledNoteOffs<V extends { noteOff(t: number): void }> {
  private groups: Group<V>[] = [];

  /** Schedule a note-off of `voices` for playback `frame` (sample-frame index). */
  schedule(frame: number, voices: V[]): void {
    if (voices.length === 0) return;
    this.groups.push({ frame, voices });
  }

  /** Fire any group whose frame has been reached, note-off'ing each voice AT the
   *  scheduled time (frame / sampleRate), not the current frame, so the gate ends
   *  exactly on T even if the audio block straddles it. */
  drainDue(nowFrame: number, sampleRate: number): void {
    if (this.groups.length === 0) return;
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      if (g.frame > nowFrame) continue;
      const t = g.frame / sampleRate;
      for (const v of g.voices) v.noteOff(t);
      this.groups.splice(i, 1);
    }
  }

  isEmpty(): boolean { return this.groups.length === 0; }
}
