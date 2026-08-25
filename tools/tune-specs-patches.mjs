// tools/tune-specs-patches.mjs
// Descriptors for the patches that are NOT from Strudel's published library —
// ones written in the REPL and handed over to be ported. Their source is
// committed verbatim under tools/patches/ and extracted by strudel-extract.mjs
// like any other; only the descriptor lives here.
//
// These come apart along a line the library tunes do not have: every `$:` line
// is tagged with the id the REPL gives it (`$0`, `$1`, … in source order), so a
// voice says WHICH LINE it is instead of being guessed apart by register or by
// gain. Read the spec next to tools/patches/<name>.strudel and the numbering is
// the file's own order.

import { paramEnv, cutoffNorm } from './tune-map.mjs';
import { KITS } from './tune-voices.mjs';

const UZU = KITS['strudel-uzu'];

/** One drums lane for a named set of `$:` lines. The patch calls neither
 *  `bank()` nor a drum `samples()` — `dough-waveforms` carries the wt_* banks
 *  and nothing else — so its bare bd/sd/hh/cp are Strudel's prebake default:
 *  uzu-drumkit, the LAST bank registered. */
const uzuLine = (id, name, lines, color, gainRef, params = {}, opts = {}) => ({
  id, name, color, preset: UZU.preset, drumkitId: 'strudel-uzu', gainRef,
  match: (v) => lines.includes(v.id) && v.s in UZU.pads,
  pad: (v) => UZU.pads[v.s] ?? null,
  params, ...opts,
});

/** A gated supersaw stab, and deliberately NOT the `LEAD Supersaw` preset.
 *
 *  Two reasons, and the first is a silent one. That preset sets
 *  `amp.builtinEnv: 0` and ships a per-voice ADSR modulator instead, so every
 *  `amp.*` param a spec writes over it lands on a knob nothing reads — the
 *  patch would look configured and sound like the preset. The second is what
 *  the preset then sounds like here: a 0.4 s release under `.seg(16)` at 135,
 *  which is three and a half sixteenths of overlap on a line that re-triggers
 *  every sixteenth. The patch's whole character is that gate.
 *
 *  One sawtooth through the unison stack is the supersaw; a second oscillator
 *  on top of seven detuned copies buys beating that is already there and costs
 *  a third of the voice. */
const supersawStab = (extra = {}) => ({
  'osc1.wave': 0, 'osc1.level': 0.8, 'osc2.level': 0, 'sub.level': 0.2,
  'master.unison': 7, 'master.detune': 24, 'master.drift': 0.2,
  'filter.cutoff': 0.5,   // a base the clip envelope overwrites on its first frame
  'filter.envAmount': 0, 'filter.builtinEnv': 0,
  'amp.builtinEnv': 1,
  'amp.attack': 0.004, 'amp.decay': 0.08, 'amp.sustain': 0.9, 'amp.release': 0.06,
  'poly.voices': 12,
  ...extra,
});

/** `lpf`/`lpq` on the supersaws are per-cycle STEPS (`<1000 200 500 …>`), not a
 *  glide — so they are held between points. Interpolating them would turn each
 *  switch into a bar-long sweep, which is a different piece of music. */
const stepFilter = (id, lineId) => ({ cycles, lengthBars, events }) => {
  const own = events.filter((e) => e.value.id === lineId);
  return [
    paramEnv(`${id}.filter.cutoff`, own, (v) => v.cutoff, cutoffNorm, cycles, lengthBars, { hold: true }),
    // Strudel's `lpq` is a biquad Q, 0..20 in this patch; the knob is 0..1 and
    // screams near the top, so 20 lands at 0.8 rather than at 1.
    paramEnv(`${id}.filter.resonance`, own, (v) => v.resonance, (q) => Math.min(1, q / 25), cycles, lengthBars, { hold: true }),
  ];
};

// The gain every lane's level is measured against: the loudest slider in the
// patch (the bass, at 2.874). Strudel's gain is plain linear amplitude
// (superdough helpers.mjs:9 sets gain.value directly), so the balance those
// sliders were left at survives the port as a ratio.
const LOUDEST = 2.874;
const level = (gain) => +(0.9 * gain / LOUDEST).toFixed(3);

// The bass runs `lpenv(-3)` with a 100 ms attack, which in superdough sweeps the
// filter from EIGHT times the written cutoff down to it over each note
// (helpers.mjs:261 — a negative env swaps min and max). Loom's filter envelope
// amounts are unsigned, and a clip envelope is read once per animation frame,
// so a 100 ms per-note sweep cannot be baked in without stepping audibly. What
// is kept is where the filter actually SITS: the geometric mean of that sweep,
// 2√2 times the written value. The slow tri2 swell underneath — the part that
// is eight bars long and audible as the bass breathing in and out — is the
// envelope.
const LPENV_MEAN = Math.sqrt(8);

/** The drum lowpass is an INSERT param, so its envelope is addressed
 *  `<lane>.fx:<slot>.<param>`. `multifilter.freq` is a 20..20000 knob and an
 *  envelope walks a knob's range LINEARLY however it is tapered for the hand
 *  (automation-knob.ts:33), so the unit value is the plain fraction. */
const DRUM_LPF_SLOT = 'sm-drum-lpf';
const drumFilterEnv = ({ cycles, lengthBars, events }) => [
  paramEnv(`drums-1.fx:${DRUM_LPF_SLOT}.freq`,
    events.filter((e) => e.value.id === '$6' || e.value.id === '$1'),
    (v) => v.cutoff, (hz) => (hz - 20) / (20000 - 20), cycles, lengthBars),
];

export const PATCH_TUNES = {
  'supersaw-mask': {
    name: 'Supersaw Mask',
    slug: 'supersaw-mask',
    bpm: 135,     // setCpm(135/4) = 0.5625 cps, and a cycle is exactly one 4/4 bar
    meter: { num: 4, den: 4 },
    key: 7,       // G — the patch is in G twice over, minor underneath and major on top
    voices: [
      // $4 — `A`, masked to 15 of every 24 bars and 1.75x louder on the eighth.
      // Its degrees are 14 and 21 BELOW the written ones, so it sits under the
      // bass rather than over it.
      { id: 'pad-lo', name: 'Supersaw Low', engineId: 'subtractive', color: '#c8a8e0',
        match: (v) => v.id === '$4',
        // Its OWN loudest note, not the mix's: the 2 -> 3.5 step is what that
        // eighth bar is for, and velocity is the only place it can live.
        gainRef: 3.5,
        params: supersawStab({ 'bus.level': level(3.5), 'bus.reverbSend': 0.2, 'bus.delaySend': 0.08 }),
        envelopes: stepFilter('pad-lo', '$4') },

      // $0 — the same figure higher up and in G MAJOR against the minor below
      // it. Never masked: this is the line that holds the 24 bars together.
      { id: 'pad-hi', name: 'Supersaw High', engineId: 'subtractive', color: '#f4b8b8',
        match: (v) => v.id === '$0',
        gainRef: 1.82,
        params: supersawStab({ 'bus.level': level(1.82), 'bus.reverbSend': 0.3, 'bus.delaySend': 0.14 }),
        envelopes: stepFilter('pad-hi', '$0') },

      // $2 — `wt_dbass`, a wavetable bank stepped by `n(run(7))` at every
      // sixteenth. Loom's wavetable engine morphs between two waves rather than
      // indexing seven, so the index becomes the MORPH: the timbre still steps
      // once per note, which is what that line sounds like. No preset — the
      // params below ARE the patch, and a preset would only be overwritten.
      { id: 'bass-1', name: 'WT Bass', engineId: 'wavetable', color: '#a8c8e8',
        match: (v) => v.id === '$2',
        gainRef: 2.874,
        params: {
          'osc.waveA': 2, 'osc.waveB': 6, 'osc.morph': 0, 'osc.detune': 0,
          'filter.resonance': 0.04,   // lpq(1) — barely any
          'amp.attack': 0.002, 'amp.decay': 0.09, 'amp.sustain': 0.4, 'amp.release': 0.05,
          'poly.voices': 8,
          'bus.level': level(2.874), 'bus.reverbSend': 0.5,   // room(.5)
        },
        envelopes: ({ cycles, lengthBars, events }) => {
          const own = events.filter((e) => e.value.id === '$2');
          return [
            paramEnv('bass-1.filter.cutoff', own, (v) => v.cutoff,
              (hz) => cutoffNorm(Math.max(hz, 1) * LPENV_MEAN), cycles, lengthBars),
            paramEnv('bass-1.osc.morph', own, (v) => v.n, (n) => n / 6, cycles, lengthBars, { hold: true }),
          ];
        } },

      // $6 + $1 — the pair the patch colours yellow: the bd/sd backbeat and the
      // eighth-note hats, both under the same `tri.range(1000,2000).slow(7)`
      // lowpass. That shared filter is why they are ONE lane with an insert on
      // it, and why the kick and clap below are a lane of their own.
      uzuLine('drums-1', 'Drums', ['$6', '$1'], '#a8e0d8', 2.166,
        { 'bus.level': level(2.166), 'bus.reverbSend': 0.08 },
        {
          inserts: [{ id: DRUM_LPF_SLOT, pluginId: 'multifilter', bypass: false, params: { freq: 1500, q: 0.7, type: 0 } }],
          envelopes: drumFilterEnv,
        }),

      // $5 + $3 — the four-on-the-floor that arrives only on the eighth bar,
      // and the clap on every fourth beat. Neither is filtered.
      uzuLine('drums-2', 'Kick & Clap', ['$5', '$3'], '#f4c8a8', 2.856,
        { 'bus.level': level(2.856), 'bus.reverbSend': 0.12 }),
    ],
  },
};
