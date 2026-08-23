// The kick's new SNAP / SDEC / TONE / DRIVE knobs, as CONTROLS rather than DSP:
// they must exist in the engine's param vocabulary (which is what the voice rack
// paints and what the automation/modulation destination registry enumerates),
// carry the right ranges, and default to the OFF value.
//
// This is the half that a DSP test cannot see: a renderer can read a param the
// engine never declares, and the knob simply is not there.

import { describe, it, expect } from 'vitest';
import { DRUM_PARAMS } from './drums-worklet-engine';
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { KICK_TONE_OPEN } from '../audio-dsp/drums/voices';

const byId = (id: string) => DRUM_PARAMS.find((p) => p.id === id);

describe('the kick exposes its new controls', () => {
  it('declares all four, as continuous knobs', () => {
    for (const leaf of ['snap', 'snapDecay', 'tone', 'drive']) {
      const p = byId(`kick.${leaf}`);
      expect(p, `kick.${leaf} is not in DRUM_PARAMS — no knob, no automation`).toBeDefined();
      expect(p!.kind).toBe('continuous');
      expect(p!.label.length).toBeGreaterThan(0);
    }
  });

  it('defaults every one of them to OFF, so no kit changed', () => {
    expect(byId('kick.snap')!.default).toBe(0);
    expect(byId('kick.drive')!.default).toBe(0);
    // TONE "off" is the filter wide open, which the DSP treats as a bypass.
    expect(byId('kick.tone')!.default).toBe(KICK_TONE_OPEN);
  });

  it('ties the TONE knob top to the same constant the DSP bypasses at', () => {
    // If these two drift apart the filter can never be fully bypassed, and every
    // default kick quietly acquires a 4-pole lowpass.
    expect(byId('kick.tone')!.max).toBe(KICK_TONE_OPEN);
  });

  it('gives them usable ranges', () => {
    expect(byId('kick.snap')!.max).toBe(1);
    expect(byId('kick.drive')!.max).toBe(1);
    const sdec = byId('kick.snapDecay')!;
    expect(sdec.min).toBeGreaterThan(0);
    expect(sdec.max).toBeGreaterThan(sdec.min);
    expect(byId('kick.tone')!.min).toBeLessThan(KICK_TONE_OPEN);
  });

  it('puts TONE and SNAP in the front row and the other two under ▸advanced', () => {
    // The rack paints curatedSynth up front and sweeps every other synth leaf
    // into the collapsed block, so this list is where the two tiers are decided.
    // tone/snap were already there for the snare — the kick joins them for free.
    const { curatedSynth } = new DrumsWorkletEngine().getRackLayout();
    expect(curatedSynth).toContain('tone');
    expect(curatedSynth).toContain('snap');
    expect(curatedSynth).not.toContain('drive');
    expect(curatedSynth).not.toContain('snapDecay');
  });
});
