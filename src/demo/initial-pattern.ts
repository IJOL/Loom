import { type PatternData, type PatternBank } from '../core/pattern';
import { type Sequencer } from '../core/sequencer';
import { DRUM_LANES } from '../core/drums';
import type { DrumMachine } from '../core/drums';
import type { ChannelStrip } from '../core/fx';

// ── Sweet Dreams-inspired demo ─────────────────────────────────────────────
// 4 slots × 4 bars (64 steps), key of C minor.
// MIDI roots: C2 = 36, A♭1 = 32, B♭1 = 34, G1 = 31, E♭2 = 39, F2 = 41.

// Real bass riff transcribed from the Sweet Dreams MIDI (Track 8, Synth Bass).
// 8th-note pattern over 2 bars (32 16th-steps), C minor, octave: C2/Eb2/Ab1/G1.
const SWEET_BASS_2BAR: Array<{ i: number; note: number }> = [
  { i: 0,  note: 36 }, { i: 2,  note: 36 }, { i: 4,  note: 36 }, { i: 6,  note: 36 },
  { i: 8,  note: 39 }, { i: 10, note: 39 }, { i: 12, note: 36 }, { i: 14, note: 36 },
  { i: 16, note: 32 }, { i: 18, note: 32 }, { i: 20, note: 32 }, { i: 22, note: 36 },
  { i: 24, note: 31 }, { i: 26, note: 31 }, { i: 28, note: 31 }, { i: 30, note: 36 },
];

// "Sweet dreams are made of this" hook (Track 2). Eb5-D5-C5-D5-Eb5-C5(long).
const SWEET_HOOK_1BAR: Array<{ i: number; note: number; tie?: boolean }> = [
  { i: 0,  note: 75 },                    // Eb5
  { i: 3,  note: 74 },                    // D5
  { i: 5,  note: 72 },                    // C5
  { i: 8,  note: 74, tie: true },         // D5 long
  { i: 12, note: 75 },                    // Eb5
  { i: 14, note: 72, tie: true },         // C5 long
];

// Cm chord (from track 1 chord track): C4 + Eb4 + G#4
const CM_CHORD = [60, 63, 68];

function fillSweetSlot(slot: PatternData, parts: {
  drum: 'silent' | 'verse' | 'chorus' | 'breakdown';
  bass: boolean;
  hook: 'none' | 'mono' | 'octave';
  chord: boolean;
}) {
  const N = 64; // 4 bars
  slot.length = N;
  slot.bass.length = N;
  slot.melody.length = N;
  for (const lane of DRUM_LANES) slot.drums[lane].length = N;
  for (let i = 0; i < N; i++) {
    slot.bass[i]   = { on: false, note: 36, accent: false, slide: false };
    slot.melody[i] = { on: false, notes: [60], accent: false, tie: false };
    for (const lane of DRUM_LANES) slot.drums[lane][i] = { on: false, accent: false };
  }

  // Bass: tile the 2-bar riff twice across 4 bars
  if (parts.bass) {
    for (let rep = 0; rep < 2; rep++) {
      for (const s of SWEET_BASS_2BAR) {
        const idx = rep * 32 + s.i;
        Object.assign(slot.bass[idx], { on: true, note: s.note, accent: s.i === 0 });
      }
    }
  }

  // Drums: classic LinnDrum-style 4-on-the-floor + backbeat snare
  if (parts.drum !== 'silent') {
    for (let b = 0; b < 4; b++) {
      const off = b * 16;
      if (parts.drum === 'breakdown') {
        if (b % 2 === 0) slot.drums.kick[off].on = true;
        slot.drums.closedHat[off + 4].on = true;
        slot.drums.closedHat[off + 12].on = true;
      } else {
        [0, 4, 8, 12].forEach((i) => { slot.drums.kick[off + i].on = true; });
        [4, 12].forEach((i) => { slot.drums.snare[off + i].on = true; });
        for (let i = 0; i < 16; i++) {
          if (parts.drum === 'chorus' || i % 2 === 0) slot.drums.closedHat[off + i].on = true;
        }
        if (parts.drum === 'chorus') {
          slot.drums.clap[off + 4].on = true;
          slot.drums.clap[off + 12].on = true;
          slot.drums.openHat[off + 6].on = true;
          if (b === 3) slot.drums.snare[off + 14].roll = 4, slot.drums.snare[off + 14].on = true;
        }
      }
    }
  }

  // Hook melody: place at bar 0 and bar 2 so it's heard immediately on play
  if (parts.hook !== 'none') {
    for (const barOff of [0, 32]) {
      for (const h of SWEET_HOOK_1BAR) {
        const idx = barOff + h.i;
        if (idx >= N) continue;
        const baseNote = h.note;
        const notes = parts.hook === 'octave' ? [baseNote - 12, baseNote] : [baseNote];
        Object.assign(slot.melody[idx], { on: true, notes, accent: h.i === 0, tie: !!h.tie });
      }
    }
  }

  // Sustained Cm chord pad — held across bars 0 and 2
  if (parts.chord) {
    for (const barOff of [0, 32]) {
      Object.assign(slot.melody[barOff], { on: true, notes: [...CM_CHORD], accent: false, tie: true });
    }
  }
}

export interface InitialPatternDeps {
  seq: Sequencer;
  bank: PatternBank;
  drums: DrumMachine;
  bassStrip: ChannelStrip;
  polyStrip: ChannelStrip;
}

export function setupInitialPattern(deps: InitialPatternDeps): void {
  const { seq, bank, drums, bassStrip, polyStrip } = deps;

  // 4 slots × 4 bars each, all using the real Sweet Dreams bass + hook from MIDI.
  fillSweetSlot(bank.slots[0], { drum: 'silent',    bass: true, hook: 'none',   chord: false }); // A - intro: bass solo
  fillSweetSlot(bank.slots[1], { drum: 'verse',     bass: true, hook: 'mono',   chord: false }); // B - verse + hook
  fillSweetSlot(bank.slots[2], { drum: 'chorus',    bass: true, hook: 'octave', chord: true  }); // C - chorus full
  fillSweetSlot(bank.slots[3], { drum: 'breakdown', bass: true, hook: 'none',   chord: true  }); // D - breakdown w/ pad

  // Default to slot B (verse with everything playing) so play is instantly recognizable.
  bank.current = 1;
  seq.setPattern(bank.slots[1]);

  // Sensible default sends
  drums.channels.snare.setReverbSend(0.25);
  drums.channels.clap.setReverbSend(0.35);
  drums.channels.openHat.setReverbSend(0.2);
  drums.channels.ride.setReverbSend(0.3);
  drums.channels.tom.setReverbSend(0.2);
  bassStrip.setReverbSend(0.1);
  polyStrip.setReverbSend(0.25);
  polyStrip.setDelaySend(0.15);
}
