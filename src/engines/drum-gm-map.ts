// src/engines/drum-gm-map.ts
// General-MIDI drum map: which MIDI numbers play which DrumMachine voice.
// Used by DrumsEngine to route midi-based note events to drum voices.

import type { DrumVoice } from '../core/drums';

export const GM_DRUM_MAP: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  37: 'rimshot',
  38: 'snare', 40: 'snare',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  39: 'clap',
  56: 'cowbell',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom',
  49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
  51: 'ride', 53: 'ride', 59: 'ride',
};

// Canonical MIDI for each voice — the value the drum-grid editor writes
// when the user toggles a cell on a given voice row.
export const VOICE_MIDI: Record<DrumVoice, number> = {
  kick: 36,
  snare: 38,
  rimshot: 37,
  closedHat: 42,
  openHat: 46,
  clap: 39,
  cowbell: 56,
  tom: 45,
  ride: 51,
  crash: 49,
};

// Short English labels for the GM percussion map (channel 10), notes 27..87.
// Used by the drum grid to label sample-drumkit rows (sampler pads) by their
// percussion name instead of a bare note name. Kept terse to fit the 54px label column.
export const GM_PERCUSSION_NAMES: Record<number, string> = {
  27: 'High Q', 28: 'Slap', 29: 'Scratch+', 30: 'Scratch-', 31: 'Sticks',
  32: 'Sq Click', 33: 'Metro', 34: 'Metro Bell',
  35: 'Kick A', 36: 'Kick', 37: 'Side Stk', 38: 'Snare', 39: 'Clap', 40: 'Snare E',
  41: 'Lo Floor', 42: 'CH', 43: 'Hi Floor', 44: 'Pedal HH', 45: 'Lo Tom', 46: 'OH',
  47: 'LoMid Tom', 48: 'HiMid Tom', 49: 'Crash 1', 50: 'Hi Tom', 51: 'Ride 1',
  52: 'China', 53: 'Ride Bell', 54: 'Tamb', 55: 'Splash', 56: 'Cowbell',
  57: 'Crash 2', 58: 'Vibrslap', 59: 'Ride 2',
  60: 'Hi Bongo', 61: 'Lo Bongo', 62: 'Mute Cga', 63: 'Open Cga', 64: 'Lo Conga',
  65: 'Hi Timb', 66: 'Lo Timb', 67: 'Hi Agogo', 68: 'Lo Agogo', 69: 'Cabasa', 70: 'Maracas',
  71: 'S Whistle', 72: 'L Whistle', 73: 'S Guiro', 74: 'L Guiro', 75: 'Claves',
  76: 'Hi Wood', 77: 'Lo Wood', 78: 'Mute Cuica', 79: 'Open Cuica',
  80: 'Mute Tri', 81: 'Open Tri', 82: 'Shaker', 83: 'Jingle', 84: 'Belltree',
  85: 'Castanet', 86: 'Mute Surdo', 87: 'Open Surdo',
};
