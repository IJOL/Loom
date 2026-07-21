import { describe, it, expect } from 'vitest';
import { samplerDynamicParamsFor, samplerSubGroupFor } from './sampler-subgroups';
import type { SessionLane } from '../session/session';

function samplerLane(rootNotes: number[]): SessionLane {
  return {
    id: 'S', name: 'Sampler', engineId: 'sampler', clips: [], inserts: [],
    engineState: { sampler: { keymap: rootNotes.map((n) => ({ sampleId: 'x', rootNote: n, loNote: n, hiNote: n })) } },
  } as SessionLane;
}

describe('samplerDynamicParamsFor', () => {
  it('emits a <zone{note}>.<leaf> spec per keymap entry', () => {
    const specs = samplerDynamicParamsFor(samplerLane([60, 62]));
    const ids = specs.map((s) => s.id);
    expect(ids).toContain('zone60.tune');
    expect(ids).toContain('zone62.tune');
    expect(ids).toContain('zone60.cutoff');
  });
  it('is empty when the lane has no keymap', () => {
    expect(samplerDynamicParamsFor({ id: 'S', name: 'S', engineId: 'sampler', clips: [], inserts: [] } as SessionLane)).toEqual([]);
  });
});

describe('samplerSubGroupFor', () => {
  it('maps a pad param to its note name', () => {
    expect(samplerSubGroupFor('zone60.tune')).toEqual({ key: 'zone60', label: 'C4' });
  });
  it('returns undefined for the sampler globals', () => {
    expect(samplerSubGroupFor('gain')).toBeUndefined();
    expect(samplerSubGroupFor('poly.voices')).toBeUndefined();
  });
});
