// src/audio-dsp/drums/drum-voice-manager.ts
// Pure pool of one-shot drum renderers. Holds the per-voice param bags, applies
// choke groups on each new hit (a hit cuts every still-ringing voice that shares
// its non-zero chokeGroup — including its own prior ring, matching
// chokeGroupMates() in src/core/drums.ts), and renders each live voice into its
// own output of an 8-output block. Output index = DRUM_VOICE_IDS index; that is
// the single source of truth for the worklet's output↔voice mapping.
//
// No Web Audio / worklet globals — driven by the drums-processor (Task 3).
import type { DrumHit, DrumRenderer, DrumVoiceId } from './types';
import { DRUM_VOICE_IDS } from './types';
import { DRUM_RENDERERS } from './voices';
import type { ParamBag } from '../types';

interface Slot { voice: DrumVoiceId; r: DrumRenderer; }

export class DrumVoiceManager {
  private params = new Map<DrumVoiceId, ParamBag>();
  private live: Slot[] = [];
  constructor(private sr: number) {}

  /** Number of voices still ringing (decay not yet elapsed). */
  get activeCount(): number { return this.live.length; }

  /** Replace a voice's live param bag (copied so the caller can mutate theirs). */
  setVoiceParams(voice: DrumVoiceId, bag: ParamBag): void {
    this.params.set(voice, { ...bag });
  }

  /** Voices choked when `voice` triggers: all voices sharing its non-zero
   *  chokeGroup (including `voice` itself, to cut its own previous ring). []
   *  if the voice has no group. Mirrors chokeGroupMates() in src/core/drums.ts. */
  private chokeMates(voice: DrumVoiceId): Set<DrumVoiceId> {
    const g = this.params.get(voice)?.chokeGroup ?? 0;
    if (!(g > 0)) return new Set();
    return new Set(DRUM_VOICE_IDS.filter((w) => (this.params.get(w)?.chokeGroup ?? 0) === g));
  }

  /** Spawn a hit: fade-choke ringing group-mates first, then allocate the voice. */
  spawn(hit: DrumHit): void {
    const t = hit.beginSec;
    const mates = this.chokeMates(hit.voice);
    if (mates.size > 0) {
      for (const slot of this.live) if (mates.has(slot.voice)) slot.r.choke(t);
    }
    const ctor = DRUM_RENDERERS[hit.voice];
    this.live.push({ voice: hit.voice, r: ctor(hit, this.params.get(hit.voice) ?? {}, this.sr) });
  }

  /** Fill `outputs[v]` (one mono buffer per DRUM_VOICE_IDS index) for this block,
   *  summing every live voice into its own output and freeing finished voices.
   *  `frame0` is the absolute sample frame of the first sample in the block. */
  renderInto(outputs: Float32Array[], frame0: number): void {
    const n = outputs[0].length;
    for (let i = 0; i < n; i++) {
      const t = (frame0 + i) / this.sr;
      for (let s = this.live.length - 1; s >= 0; s--) {
        const slot = this.live[s];
        outputs[DRUM_VOICE_IDS.indexOf(slot.voice)][i] += slot.r.renderSample(t);
        if (slot.r.done) this.live.splice(s, 1);
      }
    }
  }
}
