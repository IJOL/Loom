import { describe, it, expect } from 'vitest';
import { buildAudioGraph, createAudioGraph } from './audio-graph';
import { InsertChain } from '../plugins/fx/insert-chain';
import { collectSends, rehydrateSends } from '../session/session-host-persistence';

describe('AudioGraph master InsertChain', () => {
  it('exposes masterInsertChain wired between the master strip and masterComp.input', () => {
    const g = createAudioGraph();
    expect(g.masterInsertChain).toBeInstanceOf(InsertChain);
    // No more filterChain field.
    expect((g as any).filterChain).toBeUndefined();
    // The master EQ/pan/mute strip sits between the sum bus and the inserts:
    // master → masterStrip → InsertChain → masterComp.
    expect(g.masterStrip).toBeDefined();
    expect(g.masterStrip.serialize()).toEqual({ eqLow: 0, eqMid: 0, eqHigh: 0, pan: 0, muted: false });
    expect(g.masterInsertChain.inputNode).toBe(g.masterStrip.output);
  });
});

describe('collectSends / rehydrateSends round-trip', () => {
  it('collectSends → rehydrateSends round-trips return level + mute', () => {
    const g = buildAudioGraph(new AudioContext());
    g.fx.getSendBus('A').setReturnLevel(0.4);
    g.fx.getSendBus('B').setMuted(true);
    const snap = collectSends(g.fx, undefined);
    const g2 = buildAudioGraph(new AudioContext());
    rehydrateSends(g2.ctx, g2.fx, snap);
    expect(g2.fx.getSendBus('A').getReturnLevel()).toBeCloseTo(0.4, 3);
    expect(g2.fx.getSendBus('B').isMuted()).toBe(true);
  });
});
