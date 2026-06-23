import type { NoteSpec, SubParams, VoiceRenderer } from './types';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';

interface Slot { midi: number; allocatedAt: number; v: VoiceRenderer; }

export class VoiceManager {
  private slots: Slot[] = [];
  private maxVoices = 8;
  private params: SubParams;
  private lastT = 0;
  constructor(private sr: number, params: SubParams) {
    this.params = { ...params };
  }
  get activeCount(): number { return this.slots.length; }
  setParams(patch: Partial<SubParams>): void { Object.assign(this.params, patch); }
  setMaxVoices(n: number): void { this.maxVoices = Math.max(1, Math.min(64, Math.floor(n))); }

  spawn(note: NoteSpec): void {
    // same-midi steal first (MIDI imports retrigger without note-off), then cap.
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i].midi === note.midi) { this.slots[i].v.noteOff(this.lastT); this.slots.splice(i, 1); }
    }
    while (this.slots.length >= this.maxVoices) {
      const oldest = this.slots.shift();
      oldest?.v.noteOff(this.lastT);
    }
    this.slots.push({
      midi: note.midi, allocatedAt: note.beginSec,
      v: new SubtractiveVoiceRenderer(note, this.params, this.sr),
    });
  }

  /** Release the `count` oldest voices early (global-cap stealing). */
  steal(count: number): void {
    const n = Math.min(count, this.slots.length);
    for (let i = 0; i < n; i++) this.slots[i].v.noteOff(this.lastT);
  }

  renderSample(t: number): number {
    this.lastT = t;
    let out = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      out += s.v.renderSample(t);
      if (s.v.done) this.slots.splice(i, 1);
    }
    return out;
  }
}
