// tools/tune-specs-samples.mjs
// The tunes led by recorded sound — breaks, one-shots and multisamples — plus
// the three that are a drum pattern demonstrating one effect.

import { paramEnv, cutoffNorm } from './tune-map.mjs';
import { SQUARE, triangleVoice, acidVoice, drumVoice, samplerVoice, delayInsert } from './tune-voices.mjs';

export const SAMPLE_TUNES = {};

// ── Wave 3: the sample-led tunes ────────────────────────────────────────────

// "Melting submarine" @by Felix Roos. `.slow(3/2)` puts a bar at 1.5 cycles = 3 s,
// so 4/4 at 80 and the 375 ms pulse is an eighth. Its drums come off the full
// dirt map it loads itself, at the indices it names — `bd:5`, `sd:1`, `hh27`.
SAMPLE_TUNES.meltingsubmarine = {
  name: 'Melting Submarine', slug: 'melting', bpm: 80, meter: { num: 4, den: 4 }, key: 9,
  voices: [
    drumVoice('drums-1', 'Drums', 'strudel-melting'),
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:BASS Acid 303',
      match: (v) => v.s === 'sawtooth',
      params: acidVoice({ 'filter.resonance': 0.4, 'filter.attack': 0.1, 'amp.decay': 0.15, 'amp.sustain': 0, 'bus.reverbSend': 0.12 }),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('bass-1.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth'),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
    { id: 'blip-1', name: 'Blips', engineId: 'subtractive', color: '#a8e0d8',
      preset: 'engine:PLUCK Digital',
      match: (v) => v.s === 'triangle',
      params: triangleVoice({ 'amp.decay': 0.1, 'amp.sustain': 0, 'bus.reverbSend': 0.2, 'bus.delaySend': 0.3 }) },
  ],
};

// "Blippy Rhodes" @by Felix Roos. `.fast(3/2)` against a 333 ms pulse reads as
// an eighth at 90, which makes the 32-cycle period 24 bars.
SAMPLE_TUNES['blippy-rhodes'] = {
  name: 'Blippy Rhodes', slug: 'blippy', bpm: 90, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    drumVoice('drums-1', 'Drums', 'strudel-tidal-lo'),
    { ...samplerVoice('keys-1', 'Rhodes', 'strudel-rhodes', '#f4e0c8', { 'bus.reverbSend': 0.5, 'bus.delaySend': 0.3 }),
      match: (v) => v.s === 'rhodes' },
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:BASS Warm',
      match: (v) => v.s === 'sawtooth',
      params: acidVoice({ 'filter.cutoff': cutoffNorm(600), 'filter.resonance': 0.3, 'filter.attack': 0.2, 'amp.sustain': 0.7, 'bus.reverbSend': 0.05 }) },
  ],
};

// "Dinofunk" @by Felix Roos. cps 1 with `hh*4` at 250 ms: a cycle is HALF a bar
// at 120, which puts `bd*2` four-on-the-floor. Its bare drums come from
// uzu-drumkit — the prebake default — because it names no bank of its own.
SAMPLE_TUNES.dinofunk = {
  name: 'Dinofunk', slug: 'dinofunk', bpm: 120, meter: { num: 4, den: 4 }, key: 8,
  voices: [
    drumVoice('drums-1', 'Drums', 'strudel-uzu'),
    // The loop has no note: superdough reads its pitch out of `speed` with
    // `unit:'c'`, so playbackRate = 0.0625 x 8.005 s = 0.5 — exactly an octave
    // below the sample's own C2, which is MIDI 24 on the zone as rooted.
    { ...samplerVoice('loop-1', 'Bass Loop', 'strudel-dinobass', '#c8c8a8', { 'bus.level': 0.9 }),
      midi: () => 24, match: (v) => v.s === 'bass' },
    { ...samplerVoice('dino-1', 'Dino', 'strudel-dino', '#e0c8a8', { 'bus.reverbSend': 0.5, 'bus.delaySend': 0.8 }),
      match: (v) => v.s === 'dino' },
    { id: 'lead-1', name: 'Lead', engineId: 'subtractive', color: '#d8e8a8',
      preset: 'engine:LEAD Classic Saw',
      match: (v) => v.s === 'sawtooth',
      params: acidVoice({ 'filter.resonance': 0.35, 'amp.sustain': 0, 'bus.reverbSend': 0.4 }),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('lead-1.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth'),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
    { id: 'chords-1', name: 'Chords', engineId: 'subtractive', color: '#c8a8e0',
      preset: 'engine:PAD Warm',
      match: (v) => v.s === undefined && v.note !== undefined,
      velocity: 68,
      params: triangleVoice({ 'amp.attack': 0.05, 'amp.sustain': 0.5, 'bus.reverbSend': 0.3, 'bus.level': 0.8 }) },
  ],
};

// "Amensister" @by Felix Roos. The amen break in eight slices, `n("0 .. 7")`, so
// the slices sit on eight consecutive pads and the pad IS the index. 250 ms
// eighths at 120.
SAMPLE_TUNES.amensister = {
  name: 'Amensister', slug: 'amensister', bpm: 120, meter: { num: 4, den: 4 }, key: 7,
  voices: [
    { id: 'amen-1', name: 'Amen', color: '#f4b8b8',
      preset: 'engine:Amen Cutup', drumkitId: 'strudel-amencutup',
      match: (v) => ['amencutup', 'breath', 'east'].includes(v.s),
      pad: (v) => (v.s === 'amencutup' ? 36 + (v.n ?? 0)
        : v.s === 'breath' ? 60
        : 62 + (v.n ?? 0)) },
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:BASS Acid 303',
      register: [19, 67],   // scale('G0:minor'), plus the `rarely(add(12))` octave
      match: (v) => v.s === 'sawtooth',
      params: acidVoice({ 'filter.resonance': 0.7, 'filter.attack': 0.1, 'amp.decay': 0.1, 'amp.sustain': 0, 'bus.reverbSend': 0.15 }),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('bass-1.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth'),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
  ],
};

// "Belldub" @by Felix Roos. `.slow(5)` makes a bar 1.25 cycles; the 625 ms pulse
// is the quarter, so 96, and the window has to be a multiple of five — 40
// cycles is 32 bars. Its two sawtooth parts are told apart by what the source
// gives only the bass: resonance 20 and `shape(.6)`.
SAMPLE_TUNES.belldub = {
  name: 'Belldub', slug: 'belldub', bpm: 96, meter: { num: 4, den: 4 }, key: 7,
  voices: [
    drumVoice('drums-1', 'Percussion', 'strudel-uzu'),
    { ...samplerVoice('bell-1', 'Bell', 'strudel-handbell', '#f4e0c8', { 'bus.reverbSend': 0.35, 'bus.delaySend': 0.2 }),
      match: (v) => v.s === 'bell' },
    { id: 'bass-1', name: 'Bass', engineId: 'subtractive', color: '#a8c8e8',
      preset: 'engine:BASS Acid 303',
      register: [31, 55],   // scale('g1:dorian')
      match: (v) => v.s === 'sawtooth' && v.resonance !== undefined,
      params: acidVoice({ 'filter.cutoff': cutoffNorm(200), 'filter.resonance': 0.85, 'filter.drive': 0.6, 'amp.release': 0.05, 'bus.reverbSend': 0.05 }) },
    { id: 'chords-1', name: 'Chords', engineId: 'subtractive', color: '#c8a8e0',
      match: (v) => v.s === 'sawtooth' && v.resonance === undefined,
      preset: 'engine:PAD Warm',
      params: acidVoice({ 'filter.resonance': 0.2, 'amp.decay': 0.15, 'amp.sustain': 0, 'bus.reverbSend': 0.6, 'bus.delaySend': 0.5 }),
      envelopes: ({ cycles, lengthBars, events }) => [
        paramEnv('chords-1.filter.cutoff', events.filter((e) => e.value.s === 'sawtooth' && e.value.resonance === undefined),
          (v) => v.cutoff, cutoffNorm, cycles, lengthBars),
      ] },
    { id: 'blip-1', name: 'Blips', engineId: 'subtractive', color: '#a8e0d8',
      preset: 'engine:LEAD Square',
      register: [67, 91],   // scale('g4:dorian')
      match: (v) => v.s === 'square',
      params: acidVoice({ 'osc1.wave': SQUARE, 'filter.cutoff': cutoffNorm(2000), 'amp.decay': 0.03, 'amp.sustain': 0, 'bus.reverbSend': 0.6, 'bus.delaySend': 0.4 }) },
  ],
};

// "Wavy kalimba" @by Felix Roos. cps 1 with a 250 ms pulse: a cycle is half a
// bar at 120, so its 16-cycle period is 8 bars.
SAMPLE_TUNES['wavy-kalimba'] = {
  name: 'Wavy Kalimba', slug: 'kalimba', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    { ...samplerVoice('kalimba-1', 'Kalimba', 'strudel-kalimba', '#d8e8a8', { 'bus.reverbSend': 0.2, 'bus.delaySend': 0.3 }),
      match: (v) => v.s === 'kalimba' },
  ],
};

// "Sample demo" @by Felix Roos. A cycle is a bar at 120. Six VCSL percussion
// sounds on one kit plus two pitched VCSL instruments.
SAMPLE_TUNES['sample-demo'] = {
  name: 'Sample Demo', slug: 'sample-demo', bpm: 120, meter: { num: 4, den: 4 }, key: 2,
  voices: [
    drumVoice('perc-1', 'Percussion', 'strudel-vcsl-perc'),
    { ...samplerVoice('lead-1', 'Clavisynth', 'strudel-clavisynth', '#a8e0d8', { 'bus.reverbSend': 0.2, 'bus.delaySend': 0.25 }),
      match: (v) => v.s === 'clavisynth' },
    { ...samplerVoice('bass-1', 'Psaltery', 'strudel-psaltery', '#a8c8e8', { 'bus.reverbSend': 0.5 }),
      match: (v) => v.s === 'psaltery_pluck' },
  ],
};

// "Random bells" @by Felix Roos. `euclidLegato(3,8)` over a 250 ms eighth: a
// cycle is a bar at 120. Two different freesound one-shots, so two lanes.
SAMPLE_TUNES['random-bells'] = {
  name: 'Random Bells', slug: 'random-bells', bpm: 120, meter: { num: 4, den: 4 }, key: 2,
  voices: [
    { ...samplerVoice('bell-1', 'Bells', 'strudel-bells', '#f4e0c8', { 'bus.delaySend': 0.45 }),
      match: (v) => v.s === 'bell' },
    { ...samplerVoice('bass-1', 'Bass', 'strudel-bells-bass', '#a8c8e8', { 'bus.reverbSend': 0.15 }),
      match: (v) => v.s === 'bass' },
  ],
};

// "Bass fuge" @by Felix Roos. cps 1 with a 250 ms pulse: a cycle is half a bar
// at 120. It spells its own drum file lists, so `bd:1` here is ITS index 1 and
// not the one Melting Submarine means.
SAMPLE_TUNES['bass-fuge'] = {
  name: 'Bass Fuge', slug: 'bass-fuge', bpm: 120, meter: { num: 4, den: 4 }, key: 9,
  voices: [
    drumVoice('drums-1', 'Drums', 'strudel-bassfuge'),
    { ...samplerVoice('bass-1', 'Fingered Bass', 'strudel-flbass', '#a8c8e8', { 'bus.reverbSend': 0.1 }),
      register: [21, 79],   // scale('A1:minor')
      match: (v) => v.s === 'flbass' },
  ],
};

// "Holy flute" @by Felix Roos. 250 ms eighths, so a cycle is a bar at 120 and
// the eight-cycle period is eight bars. One VCSL ocarina, three superimposed
// copies of the same line at three speeds — one instrument, one lane.
SAMPLE_TUNES.holyflute = {
  name: 'Holy Flute', slug: 'holyflute', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    { ...samplerVoice('flute-1', 'Ocarina', 'strudel-ocarina', '#f4c8a8', { 'bus.reverbSend': 0.75 }),
      match: (v) => v.s === 'ocarina_vib' },
  ],
};

// "Chop" @by Felix Roos. The only tune in the library with no notes at all:
// `chop(128)` walks a sixteen-second recording an eighth of a second at a time,
// and `jux(rev)` walks it backwards in the other ear. Which slice sounds is in
// `begin`, so the slice INDEX is the pad — 128 of them, which is exactly the
// MIDI range. The two ears are two lanes because they are hard-panned copies
// playing different slices at the same instant.
const chopVoice = (id, name, side) => ({
  id, name, color: side < 0 ? '#a8c8e8' : '#54C571',
  preset: 'engine:Chop Slices', drumkitId: 'strudel-chop',
  params: { 'bus.pan': side },
  pad: (v) => Math.round(v.begin * 128),
});
SAMPLE_TUNES.chop = {
  name: 'Chop', slug: 'chop', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    { ...chopVoice('chop-l', 'Chop L', -1), match: (v) => v.pan === 0 },
    { ...chopVoice('chop-r', 'Chop R (rev)', 1), match: (v) => v.pan === 1 },
  ],
};

// ── The three that are drum patterns demonstrating one effect ───────────────
// Small, but they are pieces the library ships and each one is a lesson: two
// independent delay chains, a delay that changes per cycle, and a pattern that
// only reveals itself on its fourth bar.

// "Orbit" @by Felix Roos. `.orbit(2)` is the whole point: the hats go through a
// DIFFERENT delay from the kick's — a separate chain, not a second send level —
// so they are two lanes with an insert each. `s("bd <sd cp>")` on beats one and
// three makes a cycle a bar at 120.
SAMPLE_TUNES.orbit = {
  name: 'Orbit', slug: 'orbit', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    { ...drumVoice('drums-1', 'Kit', 'strudel-uzu'),
      match: (v) => ['bd', 'sd', 'cp'].includes(v.s),
      inserts: delayInsert('orbit-1-delay', 0.33, 0.6, 0.5) },
    { ...drumVoice('drums-2', 'Hats (orbit 2)', 'strudel-uzu'),
      color: '#a8e0d8',
      match: (v) => v.s === 'hh',
      inserts: delayInsert('orbit-2-delay', 0.08, 0.7, 0.8) },
  ],
};

// "Delay" @by Felix Roos. One kit, one delay, and `delay("<0 .5>")` turning it
// on and off every other cycle — which is a clip envelope on the insert's wet.
SAMPLE_TUNES['delay-tune'] = {
  name: 'Delay', slug: 'delay-tune', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [
    { ...drumVoice('drums-1', 'Kit', 'strudel-uzu'),
      inserts: delayInsert('delay-tune-delay', 0.33, 0.7, 1),
      envelopes: ({ cycles, lengthBars, events }) => [
        // An envelope value is 0..1 across the target knob's OWN [min,max], and
        // the delay's wet reaches 1.5 — so a Strudel `delay` of .5 is .5/1.5
        // here, not .5.
        paramEnv('drums-1.fx:delay-tune-delay.wet', events, (v) => v.delay, (x) => x / 1.5, cycles, lengthBars, { hold: true }),
      ] },
  ],
};

// "Sample drums" @by Felix Roos. `<bd!3 bd(3,4,3)>` is identical for three
// cycles and only differs on the fourth, which is why the period is 4 and not
// the 1 a single-repeat check reported. Quarters at 500 ms: a cycle is a bar.
SAMPLE_TUNES['sample-drums'] = {
  name: 'Sample Drums', slug: 'sample-drums', bpm: 120, meter: { num: 4, den: 4 }, key: 0,
  voices: [drumVoice('drums-1', 'Kit', 'strudel-tidal-lo')],
};

