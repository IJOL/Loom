// Preset libraries: classic drum breaks, TB-303 acid lines, polysynth melodies.
// Loaders are scale-agnostic and tile the preset to the current pattern length
// (so a 16-step Amen tiles twice into 32, four times into 64, etc.).

import { DRUM_LANES, type DrumVoice } from '../core/drums';
import type { Sequencer } from '../core/sequencer';

type DrumHit = { i: number; accent?: boolean };
type BassNote   = { i: number; note: number; accent?: boolean; slide?: boolean };
type MelodyNote = { i: number; note: number; accent?: boolean; tie?: boolean };

export interface DrumPreset   { id: string; name: string; description: string; length: number; hits: Partial<Record<DrumVoice, DrumHit[]>>; }
export interface BassPreset   { id: string; name: string; description: string; length: number; steps: BassNote[]; }
export interface MelodyPreset { id: string; name: string; description: string; length: number; steps: MelodyNote[]; }

// ── Drum breaks ────────────────────────────────────────────────────────────
export const DRUM_PRESETS: DrumPreset[] = [
  {
    id: 'four-floor', name: '4/4 House', description: 'Classic four-on-the-floor',
    length: 16,
    hits: {
      kick:      [{i:0},{i:4},{i:8},{i:12}],
      snare:     [{i:4},{i:12}],
      closedHat: [{i:2},{i:6},{i:10},{i:14}],
      openHat:   [{i:14}],
    },
  },
  {
    id: 'techno', name: 'Techno', description: 'Driving kick + off-beat hats',
    length: 16,
    hits: {
      kick:      [{i:0},{i:4},{i:8},{i:12}],
      closedHat: [{i:2},{i:6},{i:10},{i:14}],
      clap:      [{i:4,accent:true},{i:12,accent:true}],
    },
  },
  {
    id: 'amen', name: 'Amen-style Break', description: 'Choppy break feel',
    length: 16,
    hits: {
      kick:      [{i:0},{i:3,accent:true},{i:10}],
      snare:     [{i:4},{i:7},{i:12},{i:15}],
      closedHat: [{i:0},{i:2},{i:4},{i:6},{i:8},{i:10},{i:12},{i:14}],
      ride:      [{i:6},{i:14}],
    },
  },
  {
    id: 'apache', name: 'Apache', description: 'Sparse, classic break',
    length: 16,
    hits: {
      kick:      [{i:0},{i:6},{i:10}],
      snare:     [{i:4},{i:12}],
      closedHat: [{i:0},{i:2},{i:4},{i:6},{i:8},{i:10},{i:12},{i:14}],
      cowbell:   [{i:2},{i:7}],
    },
  },
  {
    id: 'funky-drummer', name: 'Funky Drummer', description: 'Stubblefield-style ghost notes',
    length: 16,
    hits: {
      kick:      [{i:0},{i:2,accent:false},{i:10}],
      snare:     [{i:4,accent:true},{i:7},{i:12,accent:true},{i:14},{i:15}],
      closedHat: [{i:0},{i:1},{i:2},{i:3},{i:4},{i:5},{i:6},{i:7},{i:8},{i:9},{i:11},{i:12},{i:13},{i:14},{i:15}],
      openHat:   [{i:10}],
    },
  },
  {
    id: 'boom-bap', name: 'Boom Bap', description: '90s hip-hop swing',
    length: 16,
    hits: {
      kick:      [{i:0,accent:true},{i:8}],
      snare:     [{i:4,accent:true},{i:12,accent:true}],
      closedHat: [{i:0},{i:2},{i:4},{i:6},{i:8},{i:10},{i:12},{i:14}],
    },
  },
  {
    id: 'trap', name: 'Trap', description: '808 trap with rolling hats',
    length: 16,
    hits: {
      kick:      [{i:0,accent:true},{i:6},{i:10}],
      snare:     [{i:8,accent:true}],
      closedHat: [{i:0},{i:2},{i:3},{i:4},{i:6},{i:7},{i:8},{i:10},{i:11},{i:12},{i:14},{i:15}],
      clap:      [{i:8}],
    },
  },
  {
    id: 'jungle', name: 'Jungle', description: 'D&B with chopped break',
    length: 16,
    hits: {
      kick:      [{i:0},{i:8,accent:true}],
      snare:     [{i:4,accent:true},{i:7},{i:12,accent:true}],
      closedHat: [{i:0},{i:1},{i:2},{i:3},{i:4},{i:5},{i:6},{i:7},{i:8},{i:9},{i:10},{i:11},{i:12},{i:13},{i:14},{i:15}],
      ride:      [{i:6}],
    },
  },
  {
    id: 'motorik', name: 'Motorik', description: 'Krautrock straight 16ths',
    length: 16,
    hits: {
      kick:      [{i:0},{i:4},{i:8},{i:12}],
      snare:     [{i:4},{i:12}],
      closedHat: [{i:0},{i:1},{i:2},{i:3},{i:4},{i:5},{i:6},{i:7},{i:8},{i:9},{i:10},{i:11},{i:12},{i:13},{i:14},{i:15}],
    },
  },
  {
    id: 'breakbeat', name: 'Breakbeat', description: 'Big beat / Chemical Brothers',
    length: 16,
    hits: {
      kick:      [{i:0,accent:true},{i:6},{i:10}],
      snare:     [{i:4},{i:12}],
      closedHat: [{i:0},{i:2},{i:4},{i:6},{i:8},{i:10},{i:12},{i:14}],
      openHat:   [{i:7}],
      clap:      [{i:12}],
    },
  },
  {
    id: 'minimal', name: 'Minimal', description: 'Sparse minimal techno',
    length: 16,
    hits: {
      kick:      [{i:0},{i:8}],
      closedHat: [{i:4},{i:12}],
      ride:      [{i:2},{i:10}],
    },
  },
  {
    id: 'half-time', name: 'Half-time', description: 'Slow weight, hip hop feel',
    length: 16,
    hits: {
      kick:      [{i:0,accent:true},{i:7}],
      snare:     [{i:8,accent:true}],
      closedHat: [{i:0},{i:2},{i:4},{i:6},{i:8},{i:10},{i:12},{i:14}],
      tom:       [{i:13}],
    },
  },
];

// ── TB-303 acid bass lines ─────────────────────────────────────────────────
// MIDI 36 = C2, 48 = C3, etc. Acid lines lean heavily on C/F/G/A roots.
export const BASS_PRESETS: BassPreset[] = [
  {
    id: 'acid-1', name: 'Acid Trip I', description: 'Octave-jumping classic',
    length: 16,
    steps: [
      {i:0,note:36},{i:1,note:36},{i:2,note:36,accent:true},{i:3,note:48,slide:true},
      {i:4,note:36},{i:6,note:43,accent:true},{i:7,note:36},
      {i:8,note:36},{i:9,note:39,slide:true},{i:10,note:36},{i:11,note:36,accent:true},
      {i:12,note:48},{i:14,note:46,accent:true,slide:true},{i:15,note:36},
    ],
  },
  {
    id: 'acid-2', name: 'Acid Trip II', description: 'Descending phrygian-ish',
    length: 16,
    steps: [
      {i:0,note:36,accent:true},{i:1,note:48,slide:true},
      {i:2,note:46},{i:3,note:44,slide:true},
      {i:4,note:43,accent:true},{i:5,note:41,slide:true},
      {i:6,note:39},{i:7,note:36},
      {i:8,note:36,accent:true},{i:9,note:48,slide:true},
      {i:10,note:46},{i:11,note:44},
      {i:12,note:43,accent:true},{i:13,note:41,slide:true},
      {i:14,note:39},{i:15,note:36},
    ],
  },
  {
    id: 'phuture', name: 'Phuture-style', description: 'Repetitive stab + tweaks',
    length: 16,
    steps: [
      {i:0,note:36,accent:true},{i:2,note:36},{i:4,note:36,accent:true},{i:6,note:36},
      {i:8,note:48,accent:true,slide:true},{i:9,note:36},
      {i:10,note:36},{i:12,note:36,accent:true},{i:14,note:36,slide:true},{i:15,note:48},
    ],
  },
  {
    id: 'hardfloor', name: 'Hardfloor Long', description: '32-step acid sequence',
    length: 32,
    steps: [
      {i:0,note:36},{i:2,note:36,accent:true},{i:3,note:48,slide:true},
      {i:4,note:36},{i:6,note:43,accent:true},{i:7,note:36},
      {i:8,note:39},{i:10,note:36},{i:11,note:46,accent:true,slide:true},
      {i:12,note:36},{i:14,note:48},{i:15,note:36,slide:true},
      {i:16,note:36,accent:true},{i:18,note:36},{i:19,note:48,slide:true},
      {i:20,note:46,accent:true},{i:22,note:43},{i:23,note:36},
      {i:24,note:36},{i:26,note:39,accent:true},{i:27,note:36},
      {i:28,note:48,accent:true,slide:true},{i:30,note:36},{i:31,note:36},
    ],
  },
  {
    id: 'walking', name: 'Walking Bass', description: 'Linear pentatonic walk',
    length: 16,
    steps: [
      {i:0,note:36},{i:2,note:39},{i:4,note:41},{i:6,note:43},
      {i:8,note:45},{i:10,note:43},{i:12,note:41},{i:14,note:39},
    ],
  },
  {
    id: 'driving', name: 'Driving 16ths', description: 'Steady root + jumps',
    length: 16,
    steps: [
      {i:0,note:36},{i:1,note:36},{i:2,note:36,accent:true},{i:3,note:36},
      {i:4,note:36},{i:5,note:36},{i:6,note:48,slide:true},{i:7,note:36},
      {i:8,note:36},{i:9,note:36},{i:10,note:36,accent:true},{i:11,note:36},
      {i:12,note:43},{i:13,note:36},{i:14,note:46,slide:true},{i:15,note:36},
    ],
  },
  {
    id: 'minor-progression', name: 'Minor Walk', description: 'I-VI-III-VII feel',
    length: 16,
    steps: [
      {i:0,note:36,accent:true},{i:2,note:36},{i:3,note:48,slide:true},
      {i:4,note:33,accent:true},{i:6,note:33},{i:7,note:45,slide:true},
      {i:8,note:40,accent:true},{i:10,note:40},{i:11,note:52,slide:true},
      {i:12,note:43,accent:true},{i:14,note:43},{i:15,note:36},
    ],
  },
];

// ── Polysynth melodies ─────────────────────────────────────────────────────
// MIDI 60 = C4. Melodies sit in 60-84 range.
export const MELODY_PRESETS: MelodyPreset[] = [
  {
    id: 'lead-cmin', name: 'Lead C Minor', description: 'Singing melodic line',
    length: 16,
    steps: [
      {i:0,note:60},{i:2,note:67,accent:true},
      {i:4,note:63},{i:6,note:65,tie:true},{i:7,note:67},
      {i:8,note:70,accent:true,tie:true},{i:10,note:67},
      {i:12,note:65},{i:14,note:63,tie:true},{i:15,note:60},
    ],
  },
  {
    id: 'arp-am', name: 'Arpeggio Am', description: 'A minor up-down',
    length: 16,
    steps: [
      {i:0,note:57},{i:1,note:60},{i:2,note:64},{i:3,note:69},
      {i:4,note:72,accent:true},{i:5,note:69},{i:6,note:64},{i:7,note:60},
      {i:8,note:57},{i:9,note:60},{i:10,note:64},{i:11,note:69},
      {i:12,note:72,accent:true},{i:13,note:69},{i:14,note:64},{i:15,note:60},
    ],
  },
  {
    id: 'stabs', name: 'Chord Stabs', description: 'Off-beat 16ths',
    length: 16,
    steps: [
      {i:2,note:60,accent:true},{i:6,note:63,accent:true},
      {i:10,note:67,accent:true},{i:14,note:65,accent:true},
    ],
  },
  {
    id: 'happy-major', name: 'Hopeful C Major', description: 'Bright ascending phrase',
    length: 16,
    steps: [
      {i:0,note:60},{i:2,note:64},{i:4,note:67,accent:true},
      {i:6,note:72,tie:true},{i:8,note:67},{i:10,note:64,tie:true},
      {i:12,note:65},{i:14,note:67,accent:true,tie:true},{i:15,note:60},
    ],
  },
  {
    id: 'phrygian-dark', name: 'Dark Phrygian', description: 'Spanish/middle-eastern flavor',
    length: 16,
    steps: [
      {i:0,note:60,accent:true},{i:2,note:61},{i:4,note:63},
      {i:6,note:65,tie:true},{i:8,note:67,accent:true},{i:10,note:65,tie:true},
      {i:12,note:63},{i:14,note:61,tie:true},{i:15,note:60},
    ],
  },
  {
    id: 'detroit-strings', name: 'Detroit Strings', description: 'Slow swelling pads (use long attack)',
    length: 32,
    steps: [
      {i:0,note:60,tie:true},{i:8,note:63,tie:true},
      {i:16,note:67,tie:true},{i:24,note:65,tie:true},
    ],
  },
  {
    id: 'arp-up', name: 'Arpeggio Up', description: 'Continuous ascending',
    length: 16,
    steps: [
      {i:0,note:60},{i:1,note:62},{i:2,note:63},{i:3,note:65},
      {i:4,note:67},{i:5,note:70},{i:6,note:72},{i:7,note:75},
      {i:8,note:67},{i:9,note:65},{i:10,note:63},{i:11,note:62},
      {i:12,note:60},{i:13,note:58},{i:14,note:55},{i:15,note:53},
    ],
  },
  {
    id: 'hook', name: 'Catchy Hook', description: '2-bar memorable line',
    length: 32,
    steps: [
      {i:0,note:67,accent:true},{i:2,note:70},{i:3,note:67},
      {i:4,note:65,tie:true},{i:6,note:63},{i:8,note:60,accent:true},
      {i:10,note:67},{i:12,note:65,tie:true},{i:14,note:63},
      {i:16,note:67,accent:true},{i:18,note:70},{i:19,note:72},
      {i:20,note:70,tie:true},{i:22,note:67},{i:24,note:65,accent:true},
      {i:26,note:63},{i:28,note:60,tie:true},
    ],
  },
];

// ── Loaders ────────────────────────────────────────────────────────────────
// All loaders TILE the preset: a 16-step preset loaded into a 32-step pattern
// repeats twice. A 32-step preset into a 16-step pattern truncates.

export function loadDrumPreset(seq: Sequencer, preset: DrumPreset) {
  for (const lane of DRUM_LANES) {
    for (const step of seq.drums[lane]) { step.on = false; step.accent = false; }
  }
  for (const lane of DRUM_LANES) {
    const hits = preset.hits[lane] ?? [];
    for (const hit of hits) {
      for (let base = 0; base < seq.length; base += preset.length) {
        const i = base + hit.i;
        if (i < seq.length) {
          seq.drums[lane][i].on = true;
          seq.drums[lane][i].accent = !!hit.accent;
        }
      }
    }
  }
}

export function loadBassPreset(seq: Sequencer, preset: BassPreset) {
  for (const step of seq.bass) { step.on = false; step.accent = false; step.slide = false; }
  for (const s of preset.steps) {
    for (let base = 0; base < seq.length; base += preset.length) {
      const i = base + s.i;
      if (i < seq.length) {
        seq.bass[i].on = true;
        seq.bass[i].note = s.note;
        seq.bass[i].accent = !!s.accent;
        seq.bass[i].slide = !!s.slide;
      }
    }
  }
}

export function loadMelodyPreset(seq: Sequencer, preset: MelodyPreset) {
  for (const step of seq.melody) { step.on = false; step.accent = false; step.tie = false; step.notes = step.notes.slice(0, 1); }
  for (const s of preset.steps) {
    for (let base = 0; base < seq.length; base += preset.length) {
      const i = base + s.i;
      if (i < seq.length) {
        seq.melody[i].on = true;
        seq.melody[i].notes = [s.note];
        seq.melody[i].accent = !!s.accent;
        seq.melody[i].tie = !!s.tie;
      }
    }
  }
}
