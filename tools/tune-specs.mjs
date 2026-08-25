// tools/tune-specs.mjs
// One descriptor per melodic Strudel tune: how to tell its voices apart, and
// what plays each. Everything else is tune-map.mjs.
//
// The tempo of each is NOT chosen: it is read off the measured pulse, the most
// common gap between onsets. Reading Swimming's seq elements as 4/4 bars — the
// obvious mistake — says 40 BPM; its pulse is a 500 ms quarter, so it is 120,
// in three.
//
// buildTune throws when the cycles do not fill whole bars, which catches a
// lopsided clip. Do NOT mistake that for a proof of the meter: 51 cycles divide
// evenly into both 3/4 and 4/4. What says Swimming is in three is the music —
// each seq element is four groups of three beats — and tune-map.test.mjs pins
// that the guard does not claim otherwise.
//
// The descriptors themselves live in four modules, split by what plays them
// (and, for tune-specs-patches, by where they came from),
// so that adding a tune never pushes one file past the size target. This file
// is only the join.

import { SYNTH_TUNES } from './tune-specs-synth.mjs';
import { PIANO_TUNES } from './tune-specs-piano.mjs';
import { SAMPLE_TUNES } from './tune-specs-samples.mjs';
import { PATCH_TUNES } from './tune-specs-patches.mjs';

export const TUNE_SPECS = { ...SYNTH_TUNES, ...PIANO_TUNES, ...SAMPLE_TUNES, ...PATCH_TUNES };
