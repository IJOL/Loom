// The drum-kit standard: adding a voice means touching five places (the union,
// DRUM_LANES, every kit, the renderer table, the GM map). These tests fail if
// any one of them is forgotten, rather than leaving a silent voice.

import { describe, it, expect } from 'vitest';
import { DRUM_LANES, KITS, seedSynthState } from './drums';
import { GM_DRUM_MAP, VOICE_MIDI } from '../engines/drum-gm-map';
import { DRUM_RENDERERS } from '../audio-dsp/drums/voices';

describe('the drum voice standard', () => {
  it('covers the GM percussion mpump patterns actually use — including rimshot and crash', () => {
    expect(DRUM_LANES).toContain('rimshot');
    expect(DRUM_LANES).toContain('crash');
  });

  it('gives every voice a GM note that routes back to it', () => {
    for (const voice of DRUM_LANES) {
      const midi = VOICE_MIDI[voice];
      expect(midi, `${voice} has no canonical MIDI note`).toBeDefined();
      expect(GM_DRUM_MAP[midi], `MIDI ${midi} does not route back to ${voice}`).toBe(voice);
    }
  });

  it('gives every voice a renderer, so none is silent', () => {
    for (const voice of DRUM_LANES) {
      expect(DRUM_RENDERERS[voice], `${voice} has no renderer`).toBeTypeOf('function');
    }
  });

  it('gives every voice synth params in every kit', () => {
    for (const kit of KITS) {
      const state = seedSynthState(kit);
      for (const voice of DRUM_LANES) {
        expect(state[voice], `kit ${kit.id} has no params for ${voice}`).toBeDefined();
      }
    }
  });
});
