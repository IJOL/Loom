// src/engines/sampler-choke.ts
// Pure choke logic for the worklet Sampler, mirroring the Drums choke model
// (src/audio-dsp/drums/drum-voice-manager.ts + src/core/drums.ts). A pad carries
// a chokeGroup (0 = none; 1..4 = a mutually-exclusive group, like CH/OH on a
// drum machine) and a retrig flag (0 = poly, 1 = mono — a re-hit of the SAME pad
// cuts its own previous voice). `chokesVoice` decides, at trigger time, whether a
// still-ringing live voice should be fast-faded; `defaultChokeGroup` gives the GM
// hi-hats their standard shared group out of the box so a freshly-loaded drumkit
// chokes its hats with no manual setup.

/** GM hi-hat trigger notes that share the standard choke group: closed (42),
 *  pedal (44) and open (46) hat. Mirrors {closedHat, openHat} → group 1 in
 *  seedSynthState (drums.ts). */
const GM_HAT_NOTES = new Set([42, 44, 46]);

/** The chokeGroup a pad defaults to before the user touches it. ONLY drumkits
 *  get the GM-hat default — a melodic instrument whose zone root happens to land
 *  on 46 must not silently become mono; everything else defaults to 0 (no choke). */
export function defaultChokeGroup(note: number, isDrumkit: boolean): number {
  return isDrumkit && GM_HAT_NOTES.has(note) ? 1 : 0;
}

/** Does a freshly-triggered pad cut a still-ringing live voice? True when they
 *  share a non-zero choke group (group choke — this also cuts the pad's own prior
 *  ring, since a pad shares its own group), OR when the trigger is mono (retrig)
 *  and the live voice is the SAME pad (self-cut, independent of any group).
 *  Audio-clip voices carry padNote -1 / group 0 so they are never choked. */
export function chokesVoice(
  trig: { chokeGroup: number; padNote: number; retrig: number },
  live: { chokeGroup: number; padNote: number },
): boolean {
  if (trig.chokeGroup > 0 && live.chokeGroup === trig.chokeGroup) return true;
  if (trig.retrig >= 1 && trig.padNote >= 0 && live.padNote === trig.padNote) return true;
  return false;
}
