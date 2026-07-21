import { describe, it, expect } from 'vitest';
// Side-effect imports register the real metadata descriptors. test/setup.ts
// globalises node-web-audio-api, so pulling drums-engine (which transitively
// imports the worklet engine) is safe here.
import './drums-engine';
import './sampler';
import { getEngine } from './registry';
import type { SessionLane } from '../session/session';

describe('drums descriptor', () => {
  it('exposes subGroupFor mapping a voice param to its name', () => {
    expect(getEngine('drums-machine')!.subGroupFor!('snare.tone')).toEqual({ key: 'snare', label: 'Snare' });
    expect(getEngine('drums-machine')!.subGroupFor!('bus.level')).toBeUndefined();
  });
  it('has no dynamicParamsFor (its per-voice params are static)', () => {
    expect(getEngine('drums-machine')!.dynamicParamsFor).toBeUndefined();
  });
});

describe('sampler descriptor', () => {
  const lane = {
    id: 'S', name: 'Sampler', engineId: 'sampler', clips: [], inserts: [],
    engineState: { sampler: { keymap: [{ sampleId: 'x', rootNote: 60, loNote: 60, hiNote: 60 }] } },
  } as SessionLane;

  it('emits per-pad params via dynamicParamsFor', () => {
    const ids = getEngine('sampler')!.dynamicParamsFor!(lane).map((s) => s.id);
    expect(ids).toContain('zone60.tune');
  });
  it('names a pad param by its note via subGroupFor', () => {
    expect(getEngine('sampler')!.subGroupFor!('zone60.cutoff')).toEqual({ key: 'zone60', label: 'C4' });
  });
});
