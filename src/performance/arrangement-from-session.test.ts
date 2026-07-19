import { describe, it, expect } from 'vitest';
import { arrangementFromSession } from './arrangement-from-session';
import { DEFAULT_METER } from '../core/meter';
import type { SessionState } from '../session/session';

const s = (over: Partial<SessionState>): SessionState =>
  ({
    name: 'Test', lanes: [], scenes: [], globalQuantize: '1/1',
    masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
    ...over,
  });

describe('arrangementFromSession', () => {
  it('one scene sizes its section by the longest clip; one event per lane', () => {
    const state = s({
      lanes: [
        { inserts: [], id: 'A', engineId: 'tb303', clips: [{ color: '#c8c8a8', gridResolution: '1/16', id: 'a1', lengthBars: 2, notes: [] }] },
        { inserts: [], id: 'B', engineId: 'drums', clips: [{ color: '#f4b8b8', gridResolution: '1/16', id: 'b1', lengthBars: 4, notes: [] }] },
      ],
      scenes: [{ id: 's0', clipPerLane: { A: 0, B: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER); // barSec=2
    expect(arr.durationSec).toBe(8); // 4 bars
    const la = arr.lanes.find((l) => l.laneId === 'A')!;
    expect(la.clipEvents).toEqual([{ clipId: 'a1', laneId: 'A', atSec: 0, untilSec: 8 }]);
  });

  it('two scenes concatenate in order; a lane present in both gets two consecutive events', () => {
    const state = s({
      lanes: [{ inserts: [], id: 'A', engineId: 'tb303', clips: [{ color: '#f4c8a8', gridResolution: '1/16', id: 'a1', lengthBars: 2, notes: [] }, { color: '#f4e0a8', gridResolution: '1/16', id: 'a2', lengthBars: 2, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }, { id: 's1', clipPerLane: { A: 1 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    const la = arr.lanes.find((l) => l.laneId === 'A')!;
    expect(la.clipEvents).toEqual([
      { clipId: 'a1', laneId: 'A', atSec: 0, untilSec: 4 },
      { clipId: 'a2', laneId: 'A', atSec: 4, untilSec: 8 },
    ]);
    expect(arr.durationSec).toBe(8);
  });

  it('a clip with a loop sub-region contributes its sub-region length, not lengthBars', () => {
    const bar = 384; // ticksPerBar 4/4
    const state = s({
      lanes: [{ inserts: [], id: 'A', engineId: 'tb303', clips: [{ color: '#d8e8a8', gridResolution: '1/16', id: 'a1', lengthBars: 4, loopEnabled: true, loopStartTick: 0, loopEndTick: 2 * bar, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    expect(arr.durationSec).toBe(4); // 2 bars, not 4
  });

  it('MIDI-style single long clip ⇒ one pass start to end', () => {
    const state = s({
      lanes: [{ inserts: [], id: 'A', engineId: 'poly', clips: [{ color: '#a8e8b8', gridResolution: '1/16', id: 'song', lengthBars: 8, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    expect(arr.lanes[0].clipEvents).toEqual([{ clipId: 'song', laneId: 'A', atSec: 0, untilSec: 16 }]);
  });
});
