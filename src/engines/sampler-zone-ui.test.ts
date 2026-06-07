/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import type { EngineUIContext } from './engine-types';
import type { KeymapEntry } from '../samples/types';

function makeCtx(ids: string[]): EngineUIContext {
  return { laneId: 'sampler-1', registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) ids.push(k.meta.id); }, registry: new Map() } as unknown as EngineUIContext;
}

describe('SamplerEngine.buildParamUI melodic per-zone params', () => {
  it('renders the channel rack with zone<root> param knobs for a melodic keymap', () => {
    const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
    const buf = ctx.createBuffer(1, 64, 44100); sampleCache.put('m', buf as unknown as AudioBuffer);
    const e = new SamplerEngine(); e.setSharedFx(new FxBus(ctx, ctx.destination));
    const km: KeymapEntry[] = [{ sampleId: 'm', rootNote: 60, loNote: 0, hiNote: 127 }];
    e.setKeymap(km);
    const host = document.createElement('div');
    const ids: string[] = [];
    e.buildParamUI(host, makeCtx(ids));
    // Melodic now uses the per-zone channel rack (each zone is a column) — the same
    // layout as a drumkit, not the old keymap list.
    expect(host.querySelector('.drum-voice-rack')).not.toBeNull();
    expect(host.querySelector('.dv-col[data-voice="zone60"]')).not.toBeNull();
    expect(ids).toContain('sampler-1.zone60.tune');
    expect(ids).toContain('sampler-1.zone60.cutoff');
  });
});
