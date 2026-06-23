import type { NoteSpec, SubParams, VoiceRenderer } from './types';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';
import type { ModulationRuntime } from './modulation-runtime';

interface Slot { midi: number; allocatedAt: number; v: VoiceRenderer; }

export class VoiceManager {
  private slots: Slot[] = [];
  private maxVoices = 8;
  private params: SubParams;
  private lastT = 0;
  private mod: ModulationRuntime | null = null;
  // Pooled per-sample modulation-offset struct — mutated in place each render
  // sample and shared (read-only) by every voice, so the real-time render
  // callback allocates nothing on the audio thread when modulation is active.
  // Covers the full subtractive modulation target set (+ ampGain tremolo).
  private readonly modOffsets = {
    filterCutoff: 0, filterResonance: 0, filterEnvAmount: 0, filterKeyTrack: 0, filterDrive: 0,
    osc1Level: 0, osc2Level: 0, subLevel: 0, noiseLevel: 0, noiseColor: 0,
    osc1Detune: 0, osc2Detune: 0, masterTune: 0, ampGain: 0,
  };
  constructor(private sr: number, params: SubParams) {
    this.params = { ...params };
  }
  get activeCount(): number { return this.slots.length; }
  setParams(patch: Partial<SubParams>): void { Object.assign(this.params, patch); }
  setMaxVoices(n: number): void { this.maxVoices = Math.max(1, Math.min(64, Math.floor(n))); }
  /** Attach a shared-LFO modulation runtime. Its per-sample offsets are applied
   *  to every active voice at read time. */
  setModulation(m: ModulationRuntime): void { this.mod = m; }

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
    // Shared-LFO offsets: computed once per sample (same for every voice) and
    // applied at read time. Reuses the pooled struct (no per-sample allocation);
    // undefined when no modulation is attached.
    let mo: typeof this.modOffsets | undefined;
    if (this.mod) {
      const m = this.modOffsets;
      m.filterCutoff    = this.mod.offsetFor('filterCutoff', t);
      m.filterResonance = this.mod.offsetFor('filterResonance', t);
      m.filterEnvAmount = this.mod.offsetFor('filterEnvAmount', t);
      m.filterKeyTrack  = this.mod.offsetFor('filterKeyTrack', t);
      m.filterDrive     = this.mod.offsetFor('filterDrive', t);
      m.osc1Level       = this.mod.offsetFor('osc1Level', t);
      m.osc2Level       = this.mod.offsetFor('osc2Level', t);
      m.subLevel        = this.mod.offsetFor('subLevel', t);
      m.noiseLevel      = this.mod.offsetFor('noiseLevel', t);
      m.noiseColor      = this.mod.offsetFor('noiseColor', t);
      m.osc1Detune      = this.mod.offsetFor('osc1Detune', t);
      m.osc2Detune      = this.mod.offsetFor('osc2Detune', t);
      m.masterTune      = this.mod.offsetFor('masterTune', t);
      m.ampGain         = this.mod.offsetFor('ampGain', t);
      mo = m;
    }
    let out = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      out += s.v.renderSample(t, mo);
      if (s.v.done) this.slots.splice(i, 1);
    }
    return out;
  }
}
