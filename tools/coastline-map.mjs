// tools/coastline-map.mjs
// Pure: the committed Strudel extraction + a variant descriptor -> a DemoSession.
// No I/O, no Strudel, no app imports — so the test can drive it directly.
//
// Time: one Strudel cycle = half a 4/4 bar. The kick's struct alternates with a
// period of two cycles, so the musical bar IS two cycles; at cps .75 that puts
// the tempo at 90 BPM and lands the patch's finest subdivision (1/8 cycle)
// exactly on a 1/16 note.

export const TPQ = 96;
export const BAR = TPQ * 4;          // 384
export const CYCLE_TICKS = BAR / 2;  // 192
export const LENGTH_BARS = 32;       // 64 cycles
export const SUB_RES = 16;
export const BPM = 90;

const ENV_LEN = LENGTH_BARS * 16 * SUB_RES;   // 8192
const VALUES_PER_CYCLE = ENV_LEN / 64;        // 128

export const cycleToTick = (c) => Math.round(c * CYCLE_TICKS);

// multifilter freq is declared over [20, 20000] and automation denormalises
// LINEARLY (automation-knob.ts), regardless of the param's display curve.
const freqNorm = (hz) => (hz - 20) / (20000 - 20);
export const CUT_LO = freqNorm(500);    // 0.024024
export const CUT_HI = freqNorm(1000);   // 0.049049
// Loom FM: fmHz = SUM over 3 modulators of f0 * level * FM_DEPTH(3) = 9*level*f0.
// Strudel: fmi * f0.  =>  level = fmi/9.
export const FM_LO = 3 / 9;             // 0.3333
export const FM_HI = 8 / 9;             // 0.8889

export const LEAD_VELOCITY = 77;        // see the plan's velocity derivation
export const LEAD_GATE_RATIO = 0.6;

// Loom's velocity curve is AFFINE — velGain01(v) = 0.3 + 1.1*(v/127) — so an
// amplitude RATIO is not a velocity ratio. Strudel plays every drum at gain 1
// except the ride, which is at .5.
//   full : velocity 99, one below the accent threshold  -> gain 1.15748
//   half : solve 0.3 + 1.1*(v/127) = 1.15748/2          -> velocity 32
export const DRUM_VELOCITY = 99;
export const DRUM_VELOCITY_HALF = 32;

const COLORS = ['#a8c8e8', '#a8e0d8', '#d8e8a8', '#f4c8a8'];
const DEFAULT_MUSICALITY = { key: 10, scale: 'minor', style: 'acid-techno', lock: false };
const defaultSends = () => [
  { id: 'A', label: 'Send A (Delay)',  returnLevel: 1, muted: false, inserts: [{ id: 'coastline-send-a', pluginId: 'delay',  params: {}, bypass: false }] },
  { id: 'B', label: 'Send B (Reverb)', returnLevel: 1, muted: false, inserts: [{ id: 'coastline-send-b', pluginId: 'reverb', params: {}, bypass: false }] },
];

const note = (start, duration, midi, velocity) => ({ start, duration, midi, velocity });
const env = (paramId, values) => ({ paramId, values, enabled: true, stepped: false });

/** A slow sine over `cyclesPerPeriod` cycles, sampled onto the envelope grid and
 *  mapped to [lo,hi]. Strudel's `sine` runs 0..1 (not -1..1) and starts at its
 *  MIDPOINT, so the phase here matches. */
function sineEnv(paramId, cyclesPerPeriod, lo, hi) {
  const values = new Array(ENV_LEN);
  for (let i = 0; i < ENV_LEN; i++) {
    const cycle = i / VALUES_PER_CYCLE;
    const unit = (Math.sin(2 * Math.PI * (cycle / cyclesPerPeriod)) + 1) / 2;
    values[i] = +(lo + unit * (hi - lo)).toFixed(6);
  }
  return env(paramId, values);
}

/** A per-cycle alternation, e.g. Strudel's "<0 .2>". */
function alternateEnv(paramId, perCycle) {
  const values = new Array(ENV_LEN);
  for (let i = 0; i < ENV_LEN; i++) {
    values[i] = perCycle[Math.floor(i / VALUES_PER_CYCLE) % perCycle.length];
  }
  return env(paramId, values);
}

const lane = (id, engineId, name, notes, opts = {}) => ({
  id, engineId, name,
  inserts: opts.inserts ?? [],
  clips: [{
    id, name, color: COLORS[0], gridResolution: '1/16',
    lengthBars: LENGTH_BARS, notes,
    ...(opts.envelopes ? { envelopes: opts.envelopes } : {}),
  }],
  ...(opts.preset ? { enginePresetName: opts.preset } : {}),
  ...(opts.engineState ? { engineState: opts.engineState } : {}),
});

// Both variants play a SAMPLE kit, so both address their pads by note:
// `zone<note>.rev`. The drumkit task is what makes this possible — before it, no
// sample kit had a rimshot pad.

/** Loom's own sounds: the Akai MPC 60 kit, which now has a real rimshot at 37.
 *  The sample VARIANTS collapse — one snare, one hat, one ride.
 *
 *  NOT SHIPPED as a demo: the crate dressing won on the ear check and one demo
 *  of a piece is enough. Kept because it is what makes this module a MAPPER
 *  rather than a one-off — it is the second dressing that proves the note data
 *  and the sounds are separable, and the test battery runs through it. Deleting
 *  it would leave `variant` a parameter with exactly one possible argument. */
export const LOOM_VARIANT = {
  name: 'Coastline',
  drums: {
    preset: 'engine:Akai MPC 60',
    engineState: { kitMode: 'sample', sampler: { keymap: [], drumkitId: 'akaimpc60' } },
    pad: (source) => ({ bd: 36, rim: 37, sd: 38, hh: 42, rd: 51 })[source] ?? null,
    // `room("<0 .2>")` rides on the [rim, sd] layer.
    revPads: [37, 38],
  },
  keys:  { engineId: 'subtractive', preset: 'engine:KEY Rhodes' },
  bass:  { engineId: 'karplus',     preset: 'engine:BASS Acoustic Upright' },
};

/** The original samples. We author this kit, so each variant gets the GM note
 *  that actually describes it and no row label lies: 38 Snare + 40 Snare E,
 *  42 CH + 44 Pedal HH + 46 OH for the three closed-hat samples, 51 Ride 1 +
 *  59 Ride 2. */
export const CRATE_VARIANT = {
  name: 'Coastline',
  drums: {
    preset: 'engine:Crate (Coastline)',
    engineState: { kitMode: 'sample', sampler: { keymap: [], drumkitId: 'crate' } },
    pad: (source, n) => {
      if (source === 'bd') return 36;
      if (source === 'rim') return 37;
      if (source === 'sd') return n === 3 ? 40 : 38;
      if (source === 'hh') return n === 1 ? 44 : n === 3 ? 46 : 42;
      if (source === 'rd') return n === 2 ? 59 : 51;
      return null;
    },
    revPads: [37, 38, 40],
  },
  keys:  { engineId: 'sampler', engineState: { sampler: { keymap: [], instrumentId: 'gm-epiano1' } } },
  bass:  { engineId: 'sampler', engineState: { sampler: { keymap: [], instrumentId: 'gm-acoustic-bass' } } },
};

export function buildCoastline(haps, variant) {
  const drums = [], keys = [], bass = [], lead = [];

  for (const e of haps.events) {
    const start = cycleToTick(e.begin);
    const span = cycleToTick(e.end) - start;
    const v = e.value;

    if (v.s === 'gm_epiano1') { keys.push(note(start, span, v.note, DRUM_VELOCITY)); continue; }
    if (v.s === 'gm_acoustic_bass') { bass.push(note(start, span, v.note, DRUM_VELOCITY)); continue; }
    if (v.s === undefined) {
      // The lead. Duration and velocity are the two things rand/perlin drive, so
      // they are baked at the MIDPOINT and the note-FX supplies the spread.
      lead.push(note(start, Math.max(1, Math.round(span * LEAD_GATE_RATIO)), v.note, LEAD_VELOCITY));
      continue;
    }
    const pad = variant.drums.pad(v.s, v.n);
    if (pad == null) continue;
    drums.push(note(start, 24, pad, v.gain === 0.5 ? DRUM_VELOCITY_HALF : DRUM_VELOCITY));
  }

  for (const list of [drums, keys, bass, lead]) list.sort((a, b) => a.start - b.start || a.midi - b.midi);

  const drumEnvs = variant.drums.revPads
    .map((padNote) => alternateEnv(`drums-1.zone${padNote}.rev`, [0, 0.2]));

  return {
    bpm: BPM,
    name: variant.name,
    lanes: [
      lane('drums-1', 'drums-machine', 'Drums', drums, {
        preset: variant.drums.preset,
        engineState: variant.drums.engineState,
        envelopes: drumEnvs,
      }),
      lane('keys-1', variant.keys.engineId, 'Rhodes', keys, {
        preset: variant.keys.preset,
        engineState: variant.keys.engineState,
        inserts: [{ id: 'coastline-phaser', pluginId: 'phaser', params: { rate: 4 }, bypass: false }],
      }),
      lane('bass-1', variant.bass.engineId, 'Bass', bass, {
        preset: variant.bass.preset,
        engineState: variant.bass.engineState,
      }),
      lane('lead-1', 'fm', 'Lead', lead, {
        // Filter BEFORE distortion: in superdough the lowpass belongs to the
        // voice and `shape` is a post-effect.
        inserts: [
          { id: 'coastline-lpf', pluginId: 'multifilter', params: { type: 0, q: 5, freq: 750 }, bypass: false },
          { id: 'coastline-shape', pluginId: 'distortion', params: { drive: 0.3 }, bypass: false },
        ],
        envelopes: [
          sineEnv('lead-1.fx:coastline-lpf.freq', 8, CUT_LO, CUT_HI),
          // The three modulators move together — one gesture, three knobs.
          sineEnv('lead-1.op2.level', 8, FM_LO, FM_HI),
          sineEnv('lead-1.op3.level', 8, FM_LO, FM_HI),
          sineEnv('lead-1.op4.level', 8, FM_LO, FM_HI),
        ],
        engineState: {
          params: {
            algorithm: 1,             // ALGORITHMS[1]: ops 2,3,4 -> op1
            'op1.ratio': 1, 'op2.ratio': 1, 'op3.ratio': 1, 'op4.ratio': 1,
            'op1.level': 0.9,
            'op1.attack': 0.005, 'op1.decay': 0.15, 'op1.sustain': 0.6, 'op1.release': 0.15,
            // Modulator envelopes must stay OUT of the way: their output scales
            // the depth, and the depth is owned by the clip envelopes above.
            'op2.attack': 0.001, 'op2.decay': 0.001, 'op2.sustain': 1, 'op2.release': 0.05,
            'op3.attack': 0.001, 'op3.decay': 0.001, 'op3.sustain': 1, 'op3.release': 0.05,
            'op4.attack': 0.001, 'op4.decay': 0.001, 'op4.sustain': 1, 'op4.release': 0.05,
            'bus.reverbSend': 0.75,
            'bus.delaySend': 0.25,
          },
          noteFx: [{
            id: 'random1', kind: 'random', enabled: true,
            params: {
              chance: 0, dropChance: 0,
              durChance: 1, durRandom: 0.3333,
              velChance: 1, velRandom: 0.29,
              velSmooth: 1, velSmoothRate: 0.75,
            },
          }],
        },
      }),
    ],
    scenes: [{
      id: 'scene-1', name: 'Coastline',
      clipPerLane: { 'drums-1': 0, 'keys-1': 0, 'bass-1': 0, 'lead-1': 0 },
    }],
    globalQuantize: '1/1',
    musicality: { ...DEFAULT_MUSICALITY },
    sends: defaultSends(),
    masterInserts: [],
  };
}
