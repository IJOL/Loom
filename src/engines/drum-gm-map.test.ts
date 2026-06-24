import { describe, it, expect } from 'vitest';
import { GM_DRUM_MAP, VOICE_MIDI, GM_PERCUSSION_NAMES } from './drum-gm-map';
import { DRUM_LANES } from '../core/drums';

describe('GM_DRUM_MAP / VOICE_MIDI', () => {
  it('round-trips every DrumVoice through VOICE_MIDI then GM_DRUM_MAP', () => {
    for (const voice of DRUM_LANES) {
      const midi = VOICE_MIDI[voice];
      expect(midi, `VOICE_MIDI[${voice}] should be defined`).toBeTypeOf('number');
      expect(GM_DRUM_MAP[midi], `GM_DRUM_MAP[${midi}] should map back to ${voice}`).toBe(voice);
    }
  });

  it('honours the canonical GM positions for the core voices', () => {
    expect(VOICE_MIDI.kick).toBe(36);
    expect(VOICE_MIDI.snare).toBe(38);
    expect(VOICE_MIDI.closedHat).toBe(42);
    expect(VOICE_MIDI.openHat).toBe(46);
    expect(VOICE_MIDI.clap).toBe(39);
  });

  it('accepts the common alias midis (kick on 35, snare on 40, etc.)', () => {
    expect(GM_DRUM_MAP[35]).toBe('kick');
    expect(GM_DRUM_MAP[40]).toBe('snare');
    expect(GM_DRUM_MAP[44]).toBe('closedHat');
  });

  it('returns undefined for unmapped midis (so the engine voice can silently drop them)', () => {
    expect(GM_DRUM_MAP[0]).toBeUndefined();
    expect(GM_DRUM_MAP[127]).toBeUndefined();
  });
});

describe('GM_PERCUSSION_NAMES', () => {
  it('labels the tropical/uncovered notes', () => {
    expect(GM_PERCUSSION_NAMES[54]).toBe('Tamb');
    expect(GM_PERCUSSION_NAMES[69]).toBe('Cabasa');
    expect(GM_PERCUSSION_NAMES[60]).toBe('Hi Bongo');
    expect(GM_PERCUSSION_NAMES[64]).toBe('Lo Conga');
    expect(GM_PERCUSSION_NAMES[36]).toBe('Kick');
  });
  it('covers the full standard GM range 35..81', () => {
    for (let n = 35; n <= 81; n++) expect(GM_PERCUSSION_NAMES[n], `note ${n}`).toBeTruthy();
  });
});
