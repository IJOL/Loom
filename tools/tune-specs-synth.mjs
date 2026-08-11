// tools/tune-specs-synth.mjs
// The tunes Loom's own engines play end to end — plus, for the four that have
// them, a drum-machine lane. Nothing here needs an audio file we do not ship.

import { paramEnv, cutoffNorm } from './tune-map.mjs';
import { TRIANGLE, SAW, SQUARE, triangleVoice, acidVoice, drumVoice } from './tune-voices.mjs';

export const SYNTH_TUNES = {};

Object.assign(SYNTH_TUNES, {
  // Koji Kondo — Super Mario World. Three voices the author already separated
  // by colour, so the port keeps his split instead of inventing one. In THREE:
  // each written seq element is 3 cycles and holds four groups of three beats.
  swimming: {
    name: 'Swimming',
    slug: 'swimming',
    bpm: 120,
    meter: { num: 3, den: 4 },
    key: 5,   // F
    voices: [
      { id: 'melody-1', name: 'Melody', engineId: 'subtractive', color: '#FFEBB5',
        preset: 'engine:LEAD Soft Sine',
        match: (v) => v.color === '#FFEBB5',
        params: triangleVoice({ 'bus.reverbSend': 0.22 }) },
      { id: 'chords-1', name: 'Chords', engineId: 'subtractive', color: '#54C571',
        preset: 'engine:PAD Warm',
        match: (v) => v.color === '#54C571',
        velocity: 74,
        params: triangleVoice({ 'amp.attack': 0.02, 'amp.decay': 0.35, 'bus.reverbSend': 0.3, 'bus.level': 0.8 }) },
      { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#0077C9',
        preset: 'engine:BASS Warm',
        match: (v) => v.color === '#0077C9',
        params: triangleVoice({ 'filter.cutoff': 0.45, 'amp.decay': 0.4, 'bus.reverbSend': 0.06 }) },
    ],
  },

  // Hirokazu Tanaka — World 1-1. The three voices differ by `clip`: the melody
  // is clipped to .95, the bass to .5, and the sub melody carries none.
  sml1: {
    name: 'World 1-1',
    slug: 'sml1',
    bpm: 120,
    meter: { num: 4, den: 4 },
    key: 0,   // C
    voices: [
      { id: 'melody-1', name: 'Melody', engineId: 'subtractive', color: '#f4c8a8',
        preset: 'engine:LEAD Square',
        match: (v) => v.clip === 0.95,
        params: triangleVoice({ 'osc1.wave': SQUARE, 'bus.reverbSend': 0.16 }) },
      { id: 'sub-1', name: 'Sub Melody', engineId: 'subtractive', color: '#a8e0d8',
        preset: 'engine:LEAD Soft Sine',
        match: (v) => v.clip === undefined,
        velocity: 80,
        params: triangleVoice({ 'bus.reverbSend': 0.2, 'bus.level': 0.8 }) },
      { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
        preset: 'engine:BASS Square',
        match: (v) => v.clip === 0.5,
        params: triangleVoice({ 'osc1.wave': SQUARE, 'filter.cutoff': 0.42, 'bus.reverbSend': 0.05 }) },
    ],
  },

  // Koji Kondo — Princess Zelda's Rescue. Also in three. `superimpose(add(.06))`
  // doubles every voice six cents up, which arrives as a FRACTIONAL midi note:
  // the pitch rounds onto the lane and the cents go on the lane's tuning, so the
  // beating between the two survives.
  'zeldas-rescue': {
    name: "Zelda's Rescue",
    slug: 'zelda',
    bpm: 90,
    meter: { num: 3, den: 4 },
    key: 7,   // G
    voices: [
      { id: 'lead-1', name: 'Triangle', engineId: 'subtractive', color: '#c8a8e0',
        preset: 'engine:LEAD Soft Sine',
        match: (v) => Number.isInteger(v.note),
        params: triangleVoice({ 'bus.reverbSend': 0.45 }) },
      { id: 'lead-2', name: 'Triangle +6c', engineId: 'subtractive', color: '#f4b8b8',
        preset: 'engine:LEAD Soft Sine',
        match: (v) => !Number.isInteger(v.note),
        params: triangleVoice({ 'master.tune': 0.06, 'bus.reverbSend': 0.45 }) },
    ],
  },

  // Felix Roos — "Waa2". Alternates sawtooth and square, so it is two lanes; the
  // cutoff is a slow cosine, which becomes a clip envelope.
  waa2: {
    name: 'Waa2',
    slug: 'waa2',
    bpm: 120,
    meter: { num: 4, den: 4 },
    key: 9,   // A
    voices: [
      { id: 'saw-1', name: 'Saw', engineId: 'subtractive', color: '#d8e8a8',
        preset: 'engine:LEAD Classic Saw',
        match: (v) => v.s === 'sawtooth',
        params: triangleVoice({ 'osc1.wave': SAW, 'filter.attack': 0.125, 'bus.reverbSend': 0.35 }),
        envelopes: ({ cycles, lengthBars, events }) => [
          paramEnv('saw-1.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth'),
            (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
        ] },
      { id: 'sq-1', name: 'Square', engineId: 'subtractive', color: '#a8c8e8',
        preset: 'engine:LEAD Square',
        match: (v) => v.s === 'square',
        params: triangleVoice({ 'osc1.wave': SQUARE, 'filter.attack': 0.125, 'bus.reverbSend': 0.35 }),
        envelopes: ({ cycles, lengthBars, events }) => [
          paramEnv('sq-1.filter.cutoff', events.filter((e) => e.value.s === 'square'),
            (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
        ] },
    ],
  },
});

SYNTH_TUNES['acidic-tooth'] = {
  name: 'Acidic Tooth', slug: 'acidic', bpm: 120, meter: { num: 4, den: 4 }, key: 5,
  voices: [
    drumVoice('drums-1', 'Drums', 'rolandtr909'),
    { id: 'acid-1', name: 'Acid', engineId: 'subtractive', color: '#d8e8a8',
      preset: 'engine:BASS Acid 303',
      match: (v) => v.s === 'sawtooth',
      params: acidVoice({ 'bus.reverbSend': 0.2, 'bus.delaySend': 0.18 }),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('acid-1.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth'),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
  ],
};

// "Flatrave" @by Felix Roos. Kick every half cycle with the snare on the odd
// halves — a backbeat, so a cycle is a bar at 120.
SYNTH_TUNES.flatrave = {
  name: 'Flatrave', slug: 'flatrave', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    drumVoice('drums-1', 'Drums', 'rolandtr909'),
    { id: 'lead-1', name: 'Square Lead', engineId: 'subtractive', color: '#c8a8e0',
      preset: 'engine:LEAD Square',
      match: (v) => v.s === 'square',
      params: acidVoice({ 'osc1.wave': SQUARE, 'filter.resonance': 0.6, 'bus.reverbSend': 0.28, 'bus.delaySend': 0.2 }),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('lead-1.filter.cutoff', events.filter((e) => e.value.s === 'square'),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
    // The sawtooth is the BASS — `G1:minor`, one fixed lpf(800) with lpq(8), so
    // it takes a param rather than a flat envelope. It only reads as a bass now
    // that the scale resolves; while `'G1 minor'` was collapsing it sat at
    // C3-G#3 and got a lead preset to match.
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#d8e8a8',
      preset: 'engine:BASS Punchy',
      register: [31, 55],   // scale('G1:minor'), so from G1 up
      match: (v) => v.s === 'sawtooth',
      params: acidVoice({ 'filter.cutoff': cutoffNorm(800), 'filter.resonance': 0.5, 'amp.decay': 0.1, 'amp.sustain': 0, 'bus.reverbSend': 0.05 }) },
    { id: 'lead-2', name: 'Arp', engineId: 'subtractive', color: '#a8e0d8',
      preset: 'engine:PLUCK Digital',
      register: [67, 91],   // scale('G4:minor')
      match: (v) => v.s === undefined && v.note !== undefined,
      params: triangleVoice({ 'amp.decay': 0.12, 'amp.sustain': 0, 'bus.delaySend': 0.25 }) },
  ],
};

// "Caverave" @by Felix Roos. Three sawtooth parts the author already separated
// by colour — brown is the bass, darkseagreen the layered keys, and the
// uncoloured one the chord voicing.
SYNTH_TUNES.caverave = {
  name: 'Caverave', slug: 'caverave', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    drumVoice('drums-1', 'Drums', 'strudel-uzu'),
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:BASS Punchy',
      match: (v) => v.s === 'sawtooth' && v.color === 'brown',
      params: acidVoice({ 'filter.resonance': 0.3, 'filter.cutoff': 0.42, 'amp.sustain': 0.9, 'bus.reverbSend': 0.05 }) },
    { id: 'keys-1', name: 'Keys', engineId: 'subtractive', color: '#54C571',
      preset: 'engine:PLUCK House Stab',
      match: (v) => v.s === 'sawtooth' && v.color === 'darkseagreen',
      params: acidVoice({ 'filter.resonance': 0.2, 'amp.decay': 0.16, 'amp.sustain': 0.3, 'bus.reverbSend': 0.24, 'bus.delaySend': 0.2 }) },
    { id: 'chords-1', name: 'Chords', engineId: 'subtractive', color: '#f4c8a8',
      preset: 'engine:PAD Warm',
      match: (v) => v.s === 'sawtooth' && v.color === undefined,
      velocity: 78,
      params: acidVoice({ 'filter.resonance': 0.15, 'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.4, 'bus.reverbSend': 0.3, 'bus.level': 0.85 }) },
  ],
};

// ── Wave 4a: pure synthesis, nothing fetched ────────────────────────────────

// John Coltrane — Giant Steps, the whole sixteen-bar form. `.slow(20)` makes a
// BAR 1.25 cycles = 2.5 s, so it is 4/4 at 96 and the 20-cycle period is the
// form, not a round number. Three voices the transcriber already coloured;
// none names an `s`, so all three take Strudel's default triangle.
SYNTH_TUNES['giant-steps'] = {
  name: 'Giant Steps', slug: 'giant-steps', bpm: 96, meter: { num: 4, den: 4 }, key: 11,
  voices: [
    { id: 'melody-1', name: 'Melody', engineId: 'subtractive', color: '#F8E71C',
      preset: 'engine:LEAD Soft Sine',
      match: (v) => v.color === '#F8E71C',
      params: triangleVoice({ 'amp.decay': 0.6, 'amp.sustain': 0.6, 'bus.reverbSend': 0.24 }) },
    { id: 'chords-1', name: 'Chords', engineId: 'subtractive', color: '#7ED321',
      preset: 'engine:PAD Warm',
      match: (v) => v.color === '#7ED321',
      velocity: 70,
      params: triangleVoice({ 'amp.attack': 0.02, 'amp.decay': 0.4, 'amp.sustain': 0.5, 'bus.reverbSend': 0.3, 'bus.level': 0.75 }) },
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#00B8D4',
      preset: 'engine:BASS Warm',
      match: (v) => v.color === '#00B8D4',
      params: triangleVoice({ 'filter.cutoff': 0.44, 'amp.decay': 0.5, 'amp.sustain': 0.5, 'bus.reverbSend': 0.08 }) },
  ],
};

// "Jux und tollerei" @by Felix Roos. `jux(rev)` is the whole point: the pattern
// plays hard LEFT while a reversed copy of it plays hard RIGHT. Strudel puts
// that in `pan`, so each of the two waveforms becomes two lanes — the extraction
// already carries the reversed timings, and only the pan has to be reproduced.
// Four notes a cycle at 500 ms: a cycle is a 4/4 bar at 120.
const juxVoice = (side) => acidVoice({
  'osc1.wave': SAW, 'filter.resonance': 0.25, 'filter.attack': 0.2,
  'amp.decay': 0.05, 'amp.sustain': 0, 'bus.pan': side,
  'bus.reverbSend': 0.3, 'bus.delaySend': 0.35,
});
SYNTH_TUNES['jux-und-tollerei'] = {
  name: 'Jux und Tollerei', slug: 'jux', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    { id: 'saw-l', name: 'Saw L', engineId: 'subtractive', color: '#d8e8a8',
      preset: 'engine:LEAD Classic Saw',
      match: (v) => v.s === 'sawtooth' && v.pan === 0,
      params: juxVoice(-1),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('saw-l.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth' && e.value.pan === 0),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
    { id: 'saw-r', name: 'Saw R (rev)', engineId: 'subtractive', color: '#54C571',
      preset: 'engine:LEAD Classic Saw',
      match: (v) => v.s === 'sawtooth' && v.pan === 1,
      params: juxVoice(1),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('saw-r.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth' && e.value.pan === 1),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
    { id: 'tri-l', name: 'Tri L', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:LEAD Soft Sine',
      match: (v) => v.s === 'triangle' && v.pan === 0,
      params: { ...juxVoice(-1), 'osc1.wave': TRIANGLE },
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('tri-l.filter.cutoff', events.filter((e) => e.value.s === 'triangle' && e.value.pan === 0),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
    { id: 'tri-r', name: 'Tri R (rev)', engineId: 'subtractive', color: '#a8e0d8',
      preset: 'engine:LEAD Soft Sine',
      match: (v) => v.s === 'triangle' && v.pan === 1,
      params: { ...juxVoice(1), 'osc1.wave': TRIANGLE },
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('tri-r.filter.cutoff', events.filter((e) => e.value.s === 'triangle' && e.value.pan === 1),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
  ],
};

// "Underground plumber" @by Felix Roos. `.fast(2/3)` stretches a bar to 1.5
// cycles = 3 s, so it is 4/4 at 80 and the echo's 1/8 lands on a 375 ms eighth.
// The square is the bassline; the uncoloured voice is the stacked chord with its
// four octave echoes, clipped to a tenth of its slot.
SYNTH_TUNES['underground-plumber'] = {
  name: 'Underground Plumber', slug: 'plumber', bpm: 80, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    drumVoice('drums-1', 'Drums', 'strudel-tidal-lo'),
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:BASS Square',
      match: (v) => v.s === 'square',
      params: acidVoice({ 'osc1.wave': SQUARE, 'filter.cutoff': cutoffNorm(400), 'filter.resonance': 0.3, 'amp.decay': 0.12, 'amp.sustain': 0, 'bus.reverbSend': 0.06 }) },
    { id: 'stab-1', name: 'Stabs', engineId: 'subtractive', color: '#c8a8e0',
      preset: 'engine:PLUCK Digital',
      match: (v) => v.s === undefined && v.note !== undefined,
      params: triangleVoice({ 'amp.attack': 0.002, 'amp.decay': 0.1, 'amp.sustain': 0, 'bus.reverbSend': 0.2, 'bus.delaySend': 0.15 }) },
  ],
};
