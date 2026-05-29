import { describe, it, expect } from 'vitest';
import { emptyArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent } from './arrangement-ops';
import { createArrangementPlayState, startArrangement, tickArrangement } from './arrangement-runtime';

describe('Arrangement DSP smoke', () => {
  it('emits a clip-launch callback inside the audio render window', async () => {
    const launches: number[] = [];
    const state = emptyArrangementState(120);
    appendClipEvent(state, 'tb-303-1', 'c1', 0);
    closePendingClipEvent(state, 'tb-303-1', 0.5);
    const ps = createArrangementPlayState();
    startArrangement(ps, 0);

    for (let t = 0; t < 1; t += 0.025) {
      tickArrangement({
        ps, state, nowCtx: t, lookaheadSec: 0.12, bpm: 120,
        onLaunchClip: (_laneId, _clipId, atCtx) => launches.push(atCtx),
        onStopLane: () => {},
        applyAutomation: () => {},
      });
    }
    expect(launches.length).toBeGreaterThanOrEqual(1);
    expect(launches[0]).toBeLessThan(0.12);
  });
});
