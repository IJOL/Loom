// How much a LAYER slot is corrected so its instrument sits beside the others.
//
// A rack sums whatever presets you put in it, and the catalogue they come from
// is not level: measured across all 229 shipped presets, energy spans 46 dB end
// to end and 29.4 dB between the 5th and 95th percentiles. Two picked at random
// can therefore differ by thirty decibels, which is not a balance problem — the
// quieter one is simply not there. Reported exactly that way.
//
// The correction belongs HERE and not in the renderer's sum. `LayersRenderer`
// adds `render * gain * trim` and says, deliberately, that it does no
// compensation: a hidden divide-by-N would make a fader reading 1.0 secretly
// mean 0.25. That principle survives intact, because this is not the renderer
// hiding arithmetic — it is the host resolving a slot's `trim`, the field that
// already carries the slot ENGINE's balance for the same reason and by the same
// route. The `gain` fader keeps meaning what it says; what changes is that 1.0
// now means the same loudness in every slot, which is what it always claimed.
//
// ENERGY, not peak. The number is the RMS of a whole three-second note — the
// strike, the body and the tail — because that is what the ear integrates and
// because peak gets this exactly wrong: a Rhodes spikes and gets out of the way
// while a sustaining saw sits at its peak for the whole note, so matching their
// peaks leaves the Rhodes buried. That is a real report, not a hypothetical.

/** The most a slot may be moved, in either direction: ×4 is +12 dB, ÷4 is −12.
 *
 *  A cap and not a free correction, because the quietest patches in the
 *  catalogue are quiet ON PURPOSE — the five lowest are all karplus guitars, a
 *  palm mute among them, and full normalisation would ask for +26.8 dB. A palm
 *  mute at the level of a sustained acid lead is not a balanced rack; it is a
 *  different instrument, with the noise floor and the fret buzz brought up to
 *  meet you. Twelve decibels closes the gap that makes a slot inaudible and
 *  leaves the gap that makes it a palm mute. */
export const NORM_LIMIT = 4;

/**
 * The gain that puts one slot's measured energy at the catalogue's centre.
 *
 * @param energy  the slot preset's measured energy, already including its
 *                engine's trim and its own `output.trim`. Undefined for a patch
 *                nobody measured — a slot turned by hand, or a preset from a
 *                plugin that ships no table.
 * @param target  the level to aim at (the catalogue median, shipped with the
 *                measurements so the two can never drift apart).
 */
export function slotNormalisation(energy: number | undefined, target: number): number {
  // Unmeasured is not "silent" — it is "unknown", and the honest answer to an
  // unknown is to leave the slot exactly as its author set it. Returning a
  // correction here would move every hand-made patch by whatever the median
  // happened to be.
  if (typeof energy !== 'number' || !Number.isFinite(energy) || energy <= 0) return 1;
  if (!Number.isFinite(target) || target <= 0) return 1;
  const want = target / energy;
  return Math.min(NORM_LIMIT, Math.max(1 / NORM_LIMIT, want));
}
