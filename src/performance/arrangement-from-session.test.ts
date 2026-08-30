import { describe, it, expect } from 'vitest';
import { arrangementFromSession } from './arrangement-from-session';
import { DEFAULT_METER } from '../core/meter';
import { songBarSec } from '../core/song-position';
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
    expect(la.clipEvents).toEqual([{ id: expect.any(String), clipId: 'a1', laneId: 'A', atSec: 0, untilSec: 8 }]);
  });

  it('two scenes concatenate in order; a lane present in both gets two consecutive events', () => {
    const state = s({
      lanes: [{ inserts: [], id: 'A', engineId: 'tb303', clips: [{ color: '#f4c8a8', gridResolution: '1/16', id: 'a1', lengthBars: 2, notes: [] }, { color: '#f4e0a8', gridResolution: '1/16', id: 'a2', lengthBars: 2, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }, { id: 's1', clipPerLane: { A: 1 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    const la = arr.lanes.find((l) => l.laneId === 'A')!;
    expect(la.clipEvents).toEqual([
      { id: expect.any(String), clipId: 'a1', laneId: 'A', atSec: 0, untilSec: 4 },
      { id: expect.any(String), clipId: 'a2', laneId: 'A', atSec: 4, untilSec: 8 },
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

  it('section placement and the ruler agree in 3/4', () => {
    const meter = { num: 3, den: 4 };
    const clipBars = 2;
    const state = s({
      lanes: [{ inserts: [], id: 'A', engineId: 'tb303', clips: [{ color: '#a8c8e8', gridResolution: '1/16', id: 'a1', lengthBars: clipBars, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, meter);
    // The Performance ruler measures the timeline with the SONG's meter (the
    // Sequencer's), so a section built from whole clips has to land on a whole
    // number of those bars — in 3/4 a 4/4 ruler reads 1.5.
    const bars = arr.durationSec / songBarSec(arr.bpm, meter);
    expect(bars).toBeCloseTo(Math.round(bars), 6);
    expect(Math.round(bars)).toBe(clipBars);
  });

  it('a section spans the seconds the clip really plays, tempo map included', () => {
    const bar = 384; // ticksPerBar 4/4
    const mk = (tempoMap?: { tick: number; bpm: number }[]) => s({
      lanes: [{ inserts: [], id: 'A', engineId: 'poly', clips: [{ color: '#b8b8e8', gridResolution: '1/16', id: 'a1', lengthBars: 2, notes: [], tempoMap }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const flat = arrangementFromSession(mk(), 120, DEFAULT_METER);
    // The second bar of this clip plays at half tempo, so it takes twice as long:
    // two bars become three bars' worth of seconds. That is what the scheduler
    // does with the same map, and the section has to agree with it.
    const varying = arrangementFromSession(
      mk([{ tick: 0, bpm: 120 }, { tick: bar, bpm: 60 }]), 120, DEFAULT_METER,
    );
    expect(varying.durationSec / flat.durationSec).toBeCloseTo(3 / 2, 6);
    expect(varying.lanes[0].clipEvents[0].untilSec).toBe(varying.durationSec);
  });

  it('KNOWN DEBT: a tempo-mapped section does not land on a ruler bar line', () => {
    // The seconds above are right — that is the fix. The BARS under them are not:
    // the Performance ruler and the length field size a bar with songBarSec at the
    // arrangement's single bpm, so a section whose clip changes tempo mid-way spans
    // a fractional number of ruler bars and its boundary falls between two bar
    // lines. ArrangementState carries bpm and meter-free bars, no tempo map, so
    // there is nothing here to make the two agree with; recorded in
    // docs/superpowers/REMAINING-WORK.md rather than papered over.
    const bar = 384; // ticksPerBar 4/4
    const clipBars = 2;
    const state = s({
      lanes: [{ inserts: [], id: 'A', engineId: 'poly', clips: [{ color: '#b8b8e8', gridResolution: '1/16', id: 'a1', lengthBars: clipBars, notes: [],
        tempoMap: [{ tick: 0, bpm: 120 }, { tick: bar, bpm: 90 }] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    const bars = arr.durationSec / songBarSec(arr.bpm, DEFAULT_METER);
    // The clip is 2 bars of music; the ruler reads it as more than 2 and less
    // than 3 — i.e. the section ends part-way through a bar it drew.
    expect(bars).toBeGreaterThan(clipBars);
    expect(bars).toBeLessThan(clipBars + 1);
  });

  it('MIDI-style single long clip ⇒ one pass start to end', () => {
    const state = s({
      lanes: [{ inserts: [], id: 'A', engineId: 'poly', clips: [{ color: '#a8e8b8', gridResolution: '1/16', id: 'song', lengthBars: 8, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    expect(arr.lanes[0].clipEvents).toEqual([{ id: expect.any(String), clipId: 'song', laneId: 'A', atSec: 0, untilSec: 16 }]);
  });
});
