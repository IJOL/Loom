import { describe, it, expect } from 'vitest';
import { applyPresetToEngine } from './preset-apply';
import type { SynthEngine } from '../engines/engine-types';

// Regression: factory:/user: presets must apply on NON-PolySynth engines
// (tb303 / karplus / fm / wavetable / drums) too. They expose no getPolySynth,
// so the old code hit `if (!ps) return;` and silently no-op'd — which is why
// every demo lane that wasn't Subtractive loaded with "(custom — no preset)".

function mockEngine(withPoly = false): { engine: SynthEngine; applied: string[]; polyApplied: string[] } {
  const applied: string[] = [];
  const polyApplied: string[] = [];
  const engine = {
    applyPreset: (name: string) => { applied.push(name); },
    // A non-PolySynth engine simply has no getPolySynth method.
    ...(withPoly ? { getPolySynth: () => ({ __fake: true, polyApplied }) } : {}),
  } as unknown as SynthEngine;
  return { engine, applied, polyApplied };
}

describe('applyPresetToEngine', () => {
  it('factory: on an engine without getPolySynth falls back to engine.applyPreset(bare)', () => {
    const { engine, applied } = mockEngine(false);
    applyPresetToEngine(engine, 'factory:BASS Acid Classic');
    expect(applied).toEqual(['BASS Acid Classic']);
  });

  it('user: on an engine without getPolySynth falls back to engine.applyPreset(bare)', () => {
    const { engine, applied } = mockEngine(false);
    applyPresetToEngine(engine, 'user:My Saved Kit');
    expect(applied).toEqual(['My Saved Kit']);
  });

  it('engine: applies via engine.applyPreset', () => {
    const { engine, applied } = mockEngine(false);
    applyPresetToEngine(engine, 'engine:PLUCK Pizzicato Strings');
    expect(applied).toEqual(['PLUCK Pizzicato Strings']);
  });
});
