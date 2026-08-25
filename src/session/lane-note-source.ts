// What a lane plays INSTEAD of its own clip.
//
// One contract, several producers. It was born inside WEAVE and carried that
// name — `WeaveSource` in `weave/weave-runtime` — while quietly growing a
// second producer in `harmony/follow-source`, which had to import from a panel's
// module to say what it returned. A third (the note generator) made that a
// pattern rather than an accident, so the contract moved out to where lanes
// live and lost the name of the first thing that used it.
//
// The same move the chord progression made on 2026-08-25, for the same reason:
// where a thing was BORN is not an argument for where it belongs.
//
// Producers are mutually exclusive on one lane, and that is deliberate: two
// answers to "what does this lane play" is precisely what one shared shape
// exists to prevent.

import type { NoteEvent } from '../core/notes';

/** A note some source produced for a lane.
 *
 *  `layerIndex` names the loop it came from, which a layered instrument reads
 *  as which of its slots should play it. Undefined for every ordinary note, and
 *  ignored by every engine but LAYERS. */
export type LaneNote = NoteEvent & { layerIndex?: number };

/** What the lane should PLAY this bar, or undefined for "play your own clip".
 *
 *  A source, not a predicate. The first shape of this hook asked "does this
 *  clip note fire?", which can only ever take notes AWAY — so at the far end of
 *  a crossfade the lane fell silent instead of handing over to the other loop.
 *  A crossfade has to be able to let hits in, and so does a generator. */
export type LaneNoteSource = () => LaneNote[] | undefined;
