// src/audio-dsp/sample/voice-cap.ts
// The sampler processor's voice-budget policy, pure so it can be pinned by a
// unit test (the processor itself only runs behind AudioWorklet globals).
//
// Steal the OLDEST voices first, never one already fading: a stolen voice keeps
// its slot until its own click-free fade reaches zero, so the pool may sit a
// couple over budget for a few milliseconds — that IS the ramp, and the reason
// there is no step to hear (the same rule as the melodic STEAL_FADE_SEC).

export interface CapSlot {
  /** Already fading out for the cap — must not be stolen twice, and still
   *  counts against the budget until its fade finishes. */
  stolen?: boolean;
}

/** Called just BEFORE a new voice is admitted: fades out enough of the oldest
 *  not-yet-stolen voices that, once their fades finish, the pool (including the
 *  incoming voice) is back at `maxVoices`. `steal` performs the fade — choke or
 *  noteOff, whichever that voice supports. */
export function stealForCap<S extends CapSlot>(
  live: readonly S[], maxVoices: number, steal: (s: S) => void,
): void {
  if (live.length < maxVoices) return;
  let need = live.length - maxVoices + 1;
  for (const slot of live) {
    if (need <= 0) break;
    if (slot.stolen) continue;
    steal(slot);
    slot.stolen = true;
    need--;
  }
}
