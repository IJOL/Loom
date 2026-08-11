// tools/tune-specs-piano.mjs
// The six tunes that end on `.piano()`. That is not a soundfont: Strudel's REPL
// points it at a 29-sample bank of a real piano, which is what these play.

import { cutoffNorm } from './tune-map.mjs';
import { acidVoice, drumVoice, pianoVoice } from './tune-voices.mjs';

export const PIANO_TUNES = {};

// ── Wave 4b: the `.piano()` tunes ───────────────────────────────────────────
// `.piano()` is not a soundfont. Strudel defines it in the REPL's prebake and it
// plays a 29-sample bank of a real piano, so the port plays that same bank
// (tools/fetch-strudel-piano.mjs → public/instruments/strudel-piano).
//
// One lane each. Several of these colour their layers, but every layer is the
// same piano through the same signal path, so splitting them would cost a
// second copy of the bank and change nothing you can hear.

// A Barry Harris exercise. `.slow(2)` leaves one note every 2 s; taking a cycle
// as the bar puts it at 120, and the transposition cycle closes the form at 64.
PIANO_TUNES['barry-harris'] = {
  name: 'Barry Harris', slug: 'barry-harris', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [{ ...pianoVoice('piano-1', 'Piano'), match: (v) => v.s === 'piano' }],
};

// "Echo piano" @by Felix Roos. Quarters at 500 ms, so a cycle is a bar at 120,
// and the whole thing closes in four.
PIANO_TUNES['echo-piano'] = {
  name: 'Echo Piano', slug: 'echo-piano', bpm: 120, meter: { num: 4, den: 4 }, key: 2,
  voices: [{ ...pianoVoice('piano-1', 'Piano', { 'bus.delaySend': 0.18 }), match: (v) => v.s === 'piano' }],
};

// "Festival of fingers" @by Felix Roos. `off(1/7, …)` puts a seventh of a cycle
// against a 384-tick bar: 54.857 ticks, so those echoes land within half a tick
// (about 1.3 ms) of where Strudel puts them. Nothing else in the library is
// off-grid like this, and no grid of ours would hold it exactly.
//
// Its gains only reach 0.44, so it plays at less than half the level of every
// other demo. The velocities stay faithful and the LANE is lifted instead, which
// keeps the author's dynamics intact.
PIANO_TUNES['festival-of-fingers'] = {
  name: 'Festival of Fingers', slug: 'fingers', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [{ ...pianoVoice('piano-1', 'Piano', { 'bus.level': 1.35, 'bus.reverbSend': 0.28 }), match: (v) => v.s === 'piano' }],
};

// "Festival of fingers 3" @by Felix Roos. cps 1 with a 167 ms pulse — a twelfth
// of a cycle — so a cycle is HALF a bar at 120 and the eight-cycle period is
// four bars. Twelfths come out at 16 ticks exactly.
PIANO_TUNES['festival-of-fingers-3'] = {
  name: 'Festival of Fingers 3', slug: 'fingers-3', bpm: 120, meter: { num: 4, den: 4 }, key: 2,
  voices: [{ ...pianoVoice('piano-1', 'Piano', { 'bus.reverbSend': 0.26 }), match: (v) => v.s === 'piano' }],
};

// "Good times" @by Felix Roos. Quarters at 500 ms; `.clip(2)` is why the notes
// run twice their slot and overlap.
PIANO_TUNES['good-times'] = {
  name: 'Good Times', slug: 'good-times', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [{ ...pianoVoice('piano-1', 'Piano'), match: (v) => v.s === 'piano' }],
};

// "Arpoon" @by Felix Roos. `.fast(3)` against a bar of one cycle makes the
// arpeggio triplets — 333 ms, or 32 ticks — and the drums say `bank('RolandTR909')`
// so they take the 909 kit rather than dirt.
PIANO_TUNES.arpoon = {
  name: 'Arpoon', slug: 'arpoon', bpm: 120, meter: { num: 4, den: 4 }, key: 9,
  voices: [
    drumVoice('drums-1', 'Drums', 'rolandtr909'),
    { ...pianoVoice('piano-1', 'Piano', { 'bus.reverbSend': 0.3, 'bus.delaySend': 0.15 }), match: (v) => v.s === 'piano' },
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:BASS Warm',
      match: (v) => v.s === 'sawtooth',
      params: acidVoice({ 'filter.cutoff': cutoffNorm(180), 'filter.resonance': 0.25, 'filter.attack': 0.1, 'amp.sustain': 0.6, 'bus.reverbSend': 0.05 }) },
  ],
};
