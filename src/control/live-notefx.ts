// src/control/live-notefx.ts
// Expand a single live-played key through the lane's CHORD note-FX only.
// Arp is temporal (needs a real-time clock) and is intentionally skipped here.
import { getNoteFxChain } from '../notefx/notefx-registry';
import { ChordProcessor, type ChordProcessorParams } from '../notefx/chord-processor';
import type { NoteFxEvent } from '../notefx/notefx-types';
import type { ScaleId } from '../core/musicality';

/** The session's key and scale. REQUIRED, not optional with a fallback: this
 *  function used to hardcode A minor, so a chord note-FX answered a live key in
 *  a different tonality from the same lane's clips. A default here would just
 *  be that bug with a longer fuse. */
export interface LiveTonality { key: number; scale: ScaleId }

export function expandChordForLane(
  laneId: string, midi: number, velocity: number, bpm: number, tonality: LiveTonality,
): number[] {
  const chain = getNoteFxChain(laneId);
  const chords = chain?.noteFx.filter((s) => s.enabled && s.kind === 'chord') ?? [];
  if (chords.length === 0) return [midi];
  let events: NoteFxEvent[] = [{ note: midi, time: 0, gate: 1, accent: velocity >= 100 }];
  for (const s of chords) {
    events = new ChordProcessor(s.params as unknown as ChordProcessorParams).process(events, { bpm, seed: 0, key: tonality.key, scale: tonality.scale });
  }
  return events.map((e) => e.note);
}
