// A tempo map is external data, and one entry of it can stop the instrument.
//
// A MIDI tempo meta-event is three bytes of microseconds-per-quarter, turned
// into bpm by `60_000_000 / us` (midi-parse.ts). Three zero bytes — which is a
// legal byte sequence, not a legal tempo — make that Infinity. Every
// tick-to-second conversion in tempo-map.ts then divides by `secPerTick(bpm)`,
// which is 0, and the note times that come out are Infinity or NaN.
//
// From there it is the lock-up this branch exists for: a note whose times are
// not numbers makes `holdEnd` NaN, every comparison against NaN is false, and
// the voice can neither reach its own gate-off nor be released by a stop.
//
// The scalar tempo is refused at its own door (bpm-broadcast). A map does not
// pass that door — the MIDI importer hands it straight to the sequencer — so it
// is refused here instead.
import { describe, it, expect } from 'vitest';
import { Sequencer } from './sequencer';
import { bpmAtTick } from './tempo-map';

const seq = () => new Sequencer({ currentTime: 0 } as unknown as AudioContext);

describe('setTempoMap', () => {
  it('keeps a map of real tempos', () => {
    const s = seq();
    s.setTempoMap([{ tick: 0, bpm: 120 }, { tick: 384, bpm: 140 }], 768);
    expect(s.tempoMap).toHaveLength(2);
    expect(bpmAtTick(s.tempoMap!, 400)).toBe(140);
    expect(s.tempoSongTicks).toBe(768);
  });

  it('drops the entries that are not tempos, and keeps the rest', () => {
    // One bad event in a long file costs that segment, not the import.
    const s = seq();
    s.setTempoMap([
      { tick: 0, bpm: 120 },
      { tick: 192, bpm: Infinity },   // three zero bytes of microseconds
      { tick: 384, bpm: NaN },
      { tick: 576, bpm: 0 },          // would divide by zero just the same
      { tick: 768, bpm: 90 },
    ], 1152);
    expect(s.tempoMap?.map((e) => e.bpm)).toEqual([120, 90]);
  });

  it('a map with nothing usable in it is no map at all', () => {
    // Not an empty map: `bpmAtTick` on an empty one has no first entry to
    // fall back to. Undefined is the shape the rest of the app already
    // handles — it means constant tempo.
    const s = seq();
    s.setTempoMap([{ tick: 0, bpm: NaN }, { tick: 384, bpm: Infinity }], 768);
    expect(s.tempoMap).toBeUndefined();
  });

  it('still clears a map when asked', () => {
    const s = seq();
    s.setTempoMap([{ tick: 0, bpm: 120 }], 384);
    s.setTempoMap(undefined);
    expect(s.tempoMap).toBeUndefined();
  });
});
