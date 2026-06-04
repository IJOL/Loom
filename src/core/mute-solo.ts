// Pure mute/solo arithmetic. The mixer columns are keyed by session lane id,
// but each lane's audio output may flow through MORE THAN ONE ChannelStrip
// (the drum bus + its 8 per-voice strips; a poly lane + its legacy `bass`/
// `poly`/`poly1` alias track ids that historical code still writes to).
// Solo'ing a lane must keep every owned strip audible — the regression this
// module replaces muted drum voices on a drums solo, leaving the bus alive
// but starved of signal.

export interface MuteSoloLane {
  /** Lane slug id (`tb-303-1`, `drums-1`, …) — the key in muteState/soloState
   *  that the mixer M/S buttons toggle. */
  id: string;
  /** Extra track ids that share this lane's mute/solo decision. */
  ownedTrackIds: string[];
}

export interface MuteSoloInputs {
  lanes: MuteSoloLane[];
  muteState: Record<string, boolean>;
  soloState: Record<string, boolean>;
}

/** Returns the per-strip muted flag for every lane id + owned track id.
 *  Caller iterates the result and calls `strip.setMuted(value)`. */
export function computeStripMutes(input: MuteSoloInputs): Record<string, boolean> {
  const anySolo = input.lanes.some((l) => input.soloState[l.id]);
  const result: Record<string, boolean> = {};
  for (const lane of input.lanes) {
    const muted = anySolo
      ? !input.soloState[lane.id]
      : !!input.muteState[lane.id];
    result[lane.id] = muted;
    for (const t of lane.ownedTrackIds) result[t] = muted;
  }
  return result;
}

/** Per-voice mute/solo arithmetic for ONE drum kit. Same rule as a mixer:
 *  if any voice is soloed, every non-soloed voice is muted; otherwise each
 *  voice follows its own mute flag. Independent of (and composes with) the
 *  lane-level mute/solo, which acts on the drum BUS strip, not these per-voice
 *  strips. Caller applies the result via `channels[voice].setMuted(value)`. */
export function computeVoiceMutes<V extends string>(
  voices: readonly V[],
  mute: Partial<Record<V, boolean>>,
  solo: Partial<Record<V, boolean>>,
): Record<V, boolean> {
  const anySolo = voices.some((v) => solo[v]);
  const out = {} as Record<V, boolean>;
  for (const v of voices) {
    out[v] = anySolo ? !solo[v] : !!mute[v];
  }
  return out;
}
