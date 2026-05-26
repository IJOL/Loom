// src/engines/drum-gm-map.ts
// General-MIDI drum map: which MIDI numbers play which DrumMachine voice.
// Used by DrumsEngine to route midi-based note events to drum voices.

import type { DrumVoice } from '../core/drums';

export const GM_DRUM_MAP: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  38: 'snare', 40: 'snare',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  39: 'clap',
  56: 'cowbell',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom',
  51: 'ride', 53: 'ride', 59: 'ride',
};

// Canonical MIDI for each voice — the value the drum-grid editor writes
// when the user toggles a cell on a given voice row.
export const VOICE_MIDI: Record<DrumVoice, number> = {
  kick: 36,
  snare: 38,
  closedHat: 42,
  openHat: 46,
  clap: 39,
  cowbell: 56,
  tom: 45,
  ride: 51,
};
