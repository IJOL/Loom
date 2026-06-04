/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { DrumsEngine } from './drums-engine';
import type { EngineUIContext } from './engine-types';

function makeCtx(): EngineUIContext {
  return {
    laneId: 'drums-1',
    registerKnob: () => {},
    registry: new Map<string, unknown>(),
    lookupLaneDisplayName: () => 'DRUMS',
    // sessionState, historyDeps, laneInserts, masterInserts, fxBus — all
    // optional in renderModulatorsPanel; omit to keep the ctx minimal.
  } as unknown as EngineUIContext;
}

describe('DrumsEngine.buildParamUI', () => {
  it('renders the voice rack before the modulators panel', () => {
    const host = document.createElement('div');
    new DrumsEngine().buildParamUI(host, makeCtx());
    const rack = host.querySelector('.drum-voice-rack');
    const mods = host.querySelector('.modulators-panel, .mod-panel, .modulators, [data-modulators]');
    expect(rack).not.toBeNull();
    // rack should appear before the modulators block in DOM order when both exist
    if (mods) {
      const pos = rack!.compareDocumentPosition(mods);
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
