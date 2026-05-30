import { describe, it, expect } from 'vitest';
import { createAudioGraph } from './audio-graph';
import { InsertChain } from '../plugins/fx/insert-chain';

describe('AudioGraph master InsertChain', () => {
  it('exposes masterInsertChain wired between master and masterComp.input', () => {
    const g = createAudioGraph();
    expect(g.masterInsertChain).toBeInstanceOf(InsertChain);
    // No more filterChain field.
    expect((g as any).filterChain).toBeUndefined();
    // masterInsertChain.inputNode is the master GainNode.
    expect(g.masterInsertChain.inputNode).toBe(g.master);
  });
});
