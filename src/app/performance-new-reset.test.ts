// @vitest-environment jsdom
//
// Regression: "New" wiped the session but left the Performance arrangement
// untouched and stayed in Performance mode — so after New the timeline showed
// the old take as orphaned "missing" bands (clipEvents pointing at deleted
// clips). resetArrangement() empties the take and returns to Session mode; the
// New-session handler calls it.

import { describe, it, expect, vi } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createPerformanceFeature } from './performance-feature';

function makePf() {
  const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
  const seq = {
    bpm: 120,
    meter: { num: 4, den: 4 },
    isPlaying: () => false,
    stop: vi.fn(),
    start: vi.fn(),
  };
  const sessionHost = { state: { lanes: [] }, laneStates: new Map(), deps: {} };
  return createPerformanceFeature({
    ctx,
    seq,
    sessionHost,
    automationRegistry: new Map(),
    onRegisterKnob: () => { /* no-op */ },
  } as unknown as Parameters<typeof createPerformanceFeature>[0]);
}

describe('New session clears the Performance arrangement', () => {
  it('resetArrangement empties the take and returns to Session mode', () => {
    const pf = makePf();

    pf.setArrangement({
      bpm: 120, durationSec: 10, lengthBars: 8,
      lanes: [{ laneId: 'tb-303-1', clipEvents: [{ clipId: 'c1', atSec: 0, durSec: 2 }], automation: [] }],
      globalAutomation: [],
      loopEnabled: true, loopStartBar: 0, loopEndBar: 4,
    } as never);
    pf.setMode('performance');

    expect(pf.arrangement.lanes.length, 'precondition: take has bands').toBeGreaterThan(0);
    expect(pf.getMode()).toBe('performance');

    pf.resetArrangement();

    expect(pf.arrangement.lanes.length, 'arrangement bands cleared').toBe(0);
    expect(pf.arrangement.loopEnabled, 'loop reset').toBeFalsy();
    expect(pf.getMode(), 'back to Session mode').toBe('session');
  });
});
