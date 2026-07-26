// The mixer's track vocabulary: the ids a strip can be addressed by, and the
// display name each one falls back to.
//
// A track is not a session lane. Lanes are created and destroyed with the
// session; these ids are the fixed set the strip allocator, the mute/solo state
// and the mixer's label lookup have always agreed on — the two original engines
// (`bass`, `poly`), the drum bus, sixteen extra poly strips, and one id per drum
// voice so a single drum lane can still be muted voice by voice. They are the
// vocabulary three unrelated modules must spell the same way, which is the whole
// reason they live together in one file.
//
// Declarations only: no side effects, nothing captured, nothing to call. Where
// this file is imported cannot change anything about boot order.
import { DRUM_LANES, type DrumVoice } from '../core/drums';

export type ExtraId =
  | 'poly1' | 'poly2' | 'poly3' | 'poly4' | 'poly5' | 'poly6' | 'poly7' | 'poly8'
  | 'poly9' | 'poly10' | 'poly11' | 'poly12' | 'poly13' | 'poly14' | 'poly15' | 'poly16';
export const EXTRA_IDS: ExtraId[] = [
  'poly1','poly2','poly3','poly4','poly5','poly6','poly7','poly8',
  'poly9','poly10','poly11','poly12','poly13','poly14','poly15','poly16',
];
export type TrackId = 'bass' | 'poly' | 'drumBus' | ExtraId | DrumVoice;
export const ALL_TRACKS: TrackId[] = ['bass', 'poly', ...EXTRA_IDS, 'drumBus', ...DRUM_LANES];

// ── Track rendering (with viewport) ────────────────────────────────────────
export const LANE_LABELS: Record<TrackId, string> = {
  bass: 'BASS', poly: 'POLY', drumBus: 'DRUM BUS',
  poly1: 'POLY 1', poly2: 'POLY 2', poly3: 'POLY 3', poly4: 'POLY 4',
  poly5: 'POLY 5', poly6: 'POLY 6', poly7: 'POLY 7', poly8: 'POLY 8', poly9: 'POLY 9',
  poly10: 'POLY 10', poly11: 'POLY 11', poly12: 'POLY 12', poly13: 'POLY 13',
  poly14: 'POLY 14', poly15: 'POLY 15', poly16: 'POLY 16',
  kick: 'KICK', snare: 'SNARE', rimshot: 'RIM', closedHat: 'CH HAT', openHat: 'OP HAT',
  clap: 'CLAP', cowbell: 'COWBLL', tom: 'TOM', ride: 'RIDE', crash: 'CRASH',
};
