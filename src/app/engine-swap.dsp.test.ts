// src/app/engine-swap.dsp.test.ts
// Layer-3: after swapLaneEngine the lane's engine instance is the new one and
// renders a measurably different spectrum from the same note.

import { describe, it, expect } from 'vitest';
import '../engines/fm';
import '../engines/wavetable';
import { createLaneAllocator } from './lane-allocator';
import { FxBus } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { OfflineAudioContext } from 'node-web-audio-api';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import type { SynthEngine } from '../engines/engine-types';

const SR = 44100, DUR = 0.35, MIDI = 48;

function renderLaneEngine(engine: SynthEngine): Promise<Float32Array> {
  return renderEngine(
    (ctx) => {
      const out = ctx.createGain();
      const voice = engine.createVoice(ctx as unknown as AudioContext, out as unknown as AudioNode);
      return { voice, output: out };
    },
    {
      durationSec: DUR,
      sampleRate: SR,
      events: [{ time: 0, type: 'trigger', midi: MIDI, gateDuration: DUR * 0.9 }],
    },
  );
}

describe('swapLaneEngine changes the lane timbre', () => {
  it('fm → wavetable swaps the engine instance and the spectrum shifts', async () => {
    const ctx = new OfflineAudioContext(1, 128, SR) as unknown as AudioContext;
    const master = ctx.createGain();
    const lanes = createLaneAllocator({
      ctx, master, fx: new FxBus(ctx, master), sidechainBus: new SidechainBus(),
      getBpm: () => 120, extraIds: [],
      // Render through the legacy node-per-note engines: the worklet renderers
      // can't run under node-web-audio-api (its AudioWorkletNode is a silent test
      // double). This test exercises the backend-agnostic swap LOGIC; worklet DSP
      // is covered by the per-renderer unit tests + Playwright.
      synthesisBackend: 'legacy',
    });

    lanes.ensureLaneResource('L', 'fm');
    const fm = lanes.getLaneEngineInstance('L')!;
    expect(fm.id).toBe('fm');
    const before = await renderLaneEngine(fm); // render BEFORE swap disposes fm

    lanes.swapLaneEngine('L', 'wavetable');
    const wt = lanes.getLaneEngineInstance('L')!;
    expect(wt.id).toBe('wavetable');
    expect(wt).not.toBe(fm);

    const after = await renderLaneEngine(wt);

    const cBefore = spectralCentroid(before, SR);
    const cAfter  = spectralCentroid(after, SR);
    // Same note, different engine → centroids differ by a clear margin (relative).
    expect(Math.abs(cAfter - cBefore)).toBeGreaterThan(cBefore * 0.1);
  });
});
