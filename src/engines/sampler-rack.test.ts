/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import type { EngineUIContext } from './engine-types';
import type { KeymapEntry } from '../samples/types';

const KIT: KeymapEntry[] = [
  { sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 's', rootNote: 38, loNote: 38, hiNote: 38 },
];
function makeCtx(ids: string[]): EngineUIContext {
  return {
    laneId: 'drums-1',
    registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) ids.push(k.meta.id); },
    registry: new Map(),
  } as unknown as EngineUIContext;
}

describe('SamplerEngine.buildParamUI drumkit rack', () => {
  it('renders the per-pad rack (note-based ids) for a GM drumkit', () => {
    const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
    const e = new SamplerEngine(); e.setSharedFx(new FxBus(ctx, ctx.destination));
    e.setKeymap(KIT);
    const host = document.createElement('div');
    const ids: string[] = [];
    e.buildParamUI(host, makeCtx(ids));
    expect(host.querySelector('.drum-voice-rack')).not.toBeNull();
    expect(host.querySelectorAll('.dv-col').length).toBe(2);
    // Pad identity is the note (zone<note>), not the GM voice name.
    expect(ids).toContain('drums-1.zone36.tune');
    expect(ids).toContain('drums-1.zone38.decay');
  });
});
