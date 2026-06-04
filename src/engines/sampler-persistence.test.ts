import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { mirrorPadParams } from '../session/session-engine-state';
import type { SessionState } from '../session/session';
import type { KeymapEntry } from '../samples/types';

const KIT: KeymapEntry[] = [{ sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 }];
function makeEngine(): SamplerEngine {
  const ctx = new OfflineAudioContext(1, 64, 44100) as unknown as AudioContext;
  const e = new SamplerEngine(); e.setSharedFx(new FxBus(ctx, ctx.destination)); e.setKeymap(KIT);
  return e;
}

describe('sampler per-pad persistence', () => {
  it('mirrorPadParams + setPadStore restores per-pad edits keyed by note', () => {
    const state = { lanes: [{ id: 'drums-1', engineState: {} }] } as unknown as SessionState;
    const a = makeEngine();
    a.setBaseValue('kick.tune', 5);
    mirrorPadParams(state, 'drums-1', a.getPadStore());
    const saved = (state.lanes[0] as { engineState: { sampler?: { padParams?: Record<number, Record<string, number>> } } })
      .engineState.sampler!.padParams!;
    expect(saved[36].tune).toBe(5);

    const b = makeEngine();
    b.setPadStore(saved as Record<number, Record<string, number>>);
    expect(b.getBaseValue('kick.tune')).toBe(5);
  });
});
