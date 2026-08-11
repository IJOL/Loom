// tools/broken-cut-map.mjs
// The committed extraction of "broken cut 1" @by froos -> a DemoSession.
//
// Time: the kick is one per cycle in steady state (the eights in cycles 0-1 and
// 32-33 are the `reset` burst), so a CYCLE IS A BEAT. At cps 1.25 that is
// 75 BPM, and the 64-cycle window is 16 bars / 51.2 s.

import {
  BAR, note, lane, demoSession, sineEnv, pointsEnv, velocityForGain, FULL_VELOCITY,
} from './strudel-map-common.mjs';

export const CYCLE_TICKS = 96;      // one beat
export const CYCLES = 64;
export const LENGTH_BARS = 16;
export const BPM = 75;

export const cycleToTick = (c) => Math.round(c * CYCLE_TICKS);

// Both engines map a normalised cutoff through 60*220^x, so a frequency becomes
// a knob value by inverting it.
export const cutoffNorm = (hz) => Math.log(hz / 60) / Math.log(220);
// Strudel's `lpenv` is in OCTAVES of filter-envelope depth; the full sweep of
// that curve is 220x, i.e. log2(220) = 7.78 octaves.
const OCTAVES_FULL = Math.log2(220);
export const envAmountFor = (lpenv) => lpenv / OCTAVES_FULL;

// Pad layout for the `brokencut` kit. The eight break slices sit at 60+ so the
// drum grid labels them by note instead of mislabelling them as toms.
export const KICK = 36, WHIRL = 37, ATTACK = 38, BREAK_BASE = 60;

/** Which pad a break trigger plays: four chops, two speeds, in the order
 *  fetch-brokencut-samples.mjs rendered them. */
export function breakPad(v) {
  const chop = Math.round(v.begin * 4);              // 0 .25 .5 .75 -> 0..3
  const fast = v.speed > 0.5 ? 4 : 0;                // the sometimes(mul(speed 1.05)) variant
  return BREAK_BASE + fast + chop;
}

export function buildBrokenCut(haps) {
  const drums = [];
  const saw = [];
  const cutoffPts = [];
  const envAmtPts = [];

  for (const e of haps.events) {
    const start = cycleToTick(e.begin);
    const span = Math.max(1, cycleToTick(e.end) - start);
    const v = e.value;

    if (v.s === 'sawtooth') {
      saw.push(note(start, span, v.note, FULL_VELOCITY));
      // These two vary per event off a perlin signal. Interpolating the values
      // the engine actually produced beats re-deriving the signal and getting
      // its phase wrong — `lpf` is set before `.late(.5).slow(4)` reshapes it.
      cutoffPts.push([e.begin, v.cutoff]);
      envAmtPts.push([e.begin, v.lpenv]);
      continue;
    }
    if (v.s === 'bd') { drums.push(note(start, 24, KICK, FULL_VELOCITY)); continue; }
    if (v.s === 'whirl') { drums.push(note(start, span, WHIRL, FULL_VELOCITY)); continue; }
    if (v.s === 'attack') { drums.push(note(start, span, ATTACK, FULL_VELOCITY)); continue; }
    if (v.s === 'breaks165') { drums.push(note(start, span, breakPad(v), FULL_VELOCITY)); continue; }
  }

  for (const list of [drums, saw]) list.sort((a, b) => a.start - b.start || a.midi - b.midi);

  // Several voices sound at once (the layer is a five-note chord) and the reset
  // overlaps copies of the pattern, so one cycle can carry more than one value
  // for a per-event param — at cycle 0, cutoffs of both 667 and 855 Hz. In
  // superdough each voice has its own filter; a Loom lane has one. Averaging
  // the simultaneous values is the collapse, and it beats arbitrarily keeping
  // whichever the sort happened to put first.
  const meanPerCycle = (points) => {
    const acc = new Map();
    for (const [c, y] of points) {
      const e = acc.get(c) ?? { sum: 0, n: 0 };
      e.sum += y; e.n++;
      acc.set(c, e);
    }
    return [...acc].map(([c, e]) => [c, e.sum / e.n]);
  };

  // Per-pad strip + choke. `cut(1)` and `cut(2)` are monophonic groups: a new
  // hit silences the previous one in the same group. The break's constant
  // gain 1.5 lives on the pad level, not on velocity — it is above what the
  // velocity curve can express without tripping the accent.
  const padParams = { [KICK]: { chokeGroup: 0 } };
  for (const n of [WHIRL, ATTACK]) padParams[n] = { chokeGroup: 2 };
  for (let i = 0; i < 8; i++) padParams[BREAK_BASE + i] = { chokeGroup: 1, level: 1.5 };

  return demoSession({
    name: 'Broken Cut',
    slug: 'brokencut',
    bpm: BPM,
    key: 3,            // the saw layer sits around c/eb/g/bb — E flat
    lanes: [
      lane('drums-1', 'drums-machine', 'Break', drums, LENGTH_BARS, {
        preset: 'engine:Broken Cut',
        engineState: {
          kitMode: 'sample',
          sampler: { keymap: [], drumkitId: 'brokencut', padParams },
        },
      }),
      lane('saw-1', 'subtractive', 'Saw', saw, LENGTH_BARS, {
        preset: 'engine:LEAD Classic Saw',
        color: '#c8a8e0',
        envelopes: [
          pointsEnv('saw-1.filter.cutoff', CYCLES, LENGTH_BARS, meanPerCycle(cutoffPts), cutoffNorm),
          pointsEnv('saw-1.filter.envAmount', CYCLES, LENGTH_BARS, meanPerCycle(envAmtPts), envAmountFor),
        ],
        engineState: {
          params: {
            'osc1.wave': 0,          // sawtooth
            'osc1.level': 0.7,
            'osc2.level': 0,
            'noise.level': 0.3,      // .noise(0.3)
            'filter.attack': 0.25,   // .lpa(.25)
            'filter.decay': 0.1,     // .lpd(.1)
            'filter.sustain': 0,     // .lps(0)
            'amp.attack': 0.01, 'amp.decay': 0.4, 'amp.sustain': 0.8, 'amp.release': 0.4,
            'bus.reverbSend': 0.8,   // .room(1).roomsize(4)
          },
        },
      }),
    ],
  });
}
