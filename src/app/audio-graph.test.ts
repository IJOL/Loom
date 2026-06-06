import { describe, it, expect } from 'vitest';
import { createAudioGraph } from './audio-graph';
import { InsertChain } from '../plugins/fx/insert-chain';

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
