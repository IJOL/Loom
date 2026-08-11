// tools/tune-voices.mjs
// The pieces every tune descriptor is built from: the oscillator wave indices,
// the voice presets, and the drum-kit table. Split out of tune-specs.mjs when
// that file passed the size target — the descriptors are data, and the things
// they are made of are not.

export const TRIANGLE = 2;   // subtractive osc1.wave: sawtooth square triangle sine sync
export const SAW = 0;
export const SQUARE = 1;

/** A soft triangle voice — the default sound when a Strudel patch names none. */
export const triangleVoice = (extra = {}) => ({
  'osc1.wave': TRIANGLE, 'osc1.level': 0.7, 'osc2.level': 0,
  'filter.cutoff': 0.62, 'filter.resonance': 0.08, 'filter.envAmount': 0.1,
  'amp.attack': 0.01, 'amp.decay': 0.5, 'amp.sustain': 0.75, 'amp.release': 0.25,
  ...extra,
});


// ── Wave 2: synth plus the drum machine ─────────────────────────────────────
// These name bd/sd/hh/cp, which is Strudel's prebaked dirt-samples bank — the
// same source our `dirt` kit was built from, so no new audio is fetched.
// Tidal spells the snare `sd` in some patches and `sn` in others; both are the
// same drum, and leaving one out silently drops every snare in the tune. The
// mapper test counts events, which is what caught it.
//
// These are the eight pads the `dirt` kit actually ships. A name that is not
// here — a tom pair, a rimshot — needs a kit that HAS it, hence the second
// table; mapping it onto `dirt` anyway would put notes on a pad with no sample
// behind it, which is silence rather than an error. tune-map.test.mjs checks
// every drum note against its own kit's JSON so that cannot ship.
export const DIRT_PAD = { bd: 36, sd: 38, sn: 38, hh: 42, oh: 46, cp: 39, mt: 45, rd: 51 };
export const KIT_909_PAD = { ...DIRT_PAD, rim: 37, lt: 41, ht: 48, cr: 49 };
export const KITS = {
  dirt: { preset: 'engine:Dirt (samples)', pads: DIRT_PAD },
  rolandtr909: { preset: 'engine:Roland TR 909', pads: KIT_909_PAD },
  // What a BARE `bd` actually plays: Strudel's prebake loads six banks and
  // uzu-drumkit is LAST, so a tune that names neither `samples()` nor a
  // `bank()` gets these. Caverave, Dinofunk and Belldub are all in that case —
  // and Caverave shipped on `dirt`, which is a different kit entirely.
  // Flatrave and Acidic Tooth say `bank('RolandTR909')` and shipped on `dirt`
  // too; both now take the 909 we already had.
  'strudel-uzu': { preset: 'engine:Uzu (Strudel default)', pads: { ...KIT_909_PAD, misc: 76 } },
  'strudel-tidal-lo': { preset: 'engine:Tidal (Dirt)', pads: { bd: 36, sd: 38, sn: 38, cp: 39, hh: 42 } },
  'strudel-melting': { preset: 'engine:Melting Submarine Drums', pads: { bd: 36, sd: 38, hh27: 42 } },
  'strudel-bassfuge': { preset: 'engine:Bass Fuge Drums', pads: { bd: 36, sd: 38, hh: 42 } },
  'strudel-vcsl-perc': { preset: 'engine:VCSL Percussion', pads: { snare_rim: 37, gong: 52, brakedrum: 53, cowbell: 56, woodblock: 76 } },
};

/** One drums lane for every percussive source in a tune. */
export const drumVoice = (id = 'drums-1', name = 'Drums', kitId = 'dirt') => ({
  id, name, color: '#f4b8b8',
  preset: KITS[kitId].preset,
  drumkitId: kitId,
  match: (v) => v.s in KITS[kitId].pads,
  pad: (v) => KITS[kitId].pads[v.s] ?? null,
});

export const acidVoice = (extra = {}) => ({
  'osc1.wave': SAW, 'osc1.level': 0.75, 'osc2.level': 0,
  'filter.resonance': 0.72, 'filter.envAmount': 0.55,
  'filter.attack': 0.005, 'filter.decay': 0.18, 'filter.sustain': 0,
  'amp.attack': 0.005, 'amp.decay': 0.25, 'amp.sustain': 0.2, 'amp.release': 0.12,
  ...extra,
});

// "acidic tooth" @by eddyflux. cps 1 with a 125 ms pulse: a sixteenth at 120,

/** One lane on the shared piano bank; every `.piano()` tune uses it. */
export const pianoVoice = (id, name, extra = {}) => ({
  id, name, engineId: 'sampler', color: '#f4e0c8',
  instrumentId: 'strudel-piano',
  // The bank is polyphonic and these pieces are written in echoes; the default
  // eight voices would steal notes the source lets ring.
  params: { 'poly.voices': 16, 'bus.reverbSend': 0.22, ...extra },
});

/** One lane on any other bundled sampler instrument. */
export const samplerVoice = (id, name, instrumentId, color, extra = {}) => ({
  id, name, engineId: 'sampler', color, instrumentId,
  params: { 'poly.voices': 16, ...extra },
});

/** A delay in a lane's OWN insert chain — what `.orbit(n)` needs, since that
 *  gives a part a separate effect rather than a different send level. */
export const delayInsert = (id, time, feedback, wet) => ([
  { id, pluginId: 'delay', bypass: false, params: { time, feedback, wet } },
]);
