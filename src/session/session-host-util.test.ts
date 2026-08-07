import { describe, it, expect } from 'vitest';
import { nextLaneSlug, clipToShowOnLaneSwitch } from './session-host-util';
import { registerPluginEngine } from '../../test/plugin-fixtures';
import type { SessionState, SessionClip, SessionLane } from './session';

// tb303 and subtractive ship as plugins: the equivalent of the old
// side-effect import is that manifest going through the same adoptComponents
// door the plugin loader uses.
registerPluginEngine('tb303');
registerPluginEngine('subtractive');

// Three of the five are plugins now, so their prefix comes from the manifest's
// capabilities rather than from a module in src/. The claim below does not
// change: the ENGINE answers, not a ternary chain in the host.
for (const id of ['fm', 'wavetable', 'westcoast']) registerPluginEngine(id);

describe('nextLaneSlug after the five declare their capabilities', () => {
  it('reads every prefix from the capability, with no hardcoded chain left', () => {
    // Each engine must ANSWER for itself. While the ternary chain existed these
    // passed for the wrong reason, so this test only means something once the
    // fallback is gone (same step).
    expect(nextLaneSlug(new Set(), 'tb303')).toBe('tb-303-1');
    expect(nextLaneSlug(new Set(), 'subtractive')).toBe('subtractive-1');
    expect(nextLaneSlug(new Set(), 'fm')).toBe('fm-4-op-1');
    expect(nextLaneSlug(new Set(), 'wavetable')).toBe('wavetable-1');
    expect(nextLaneSlug(new Set(), 'westcoast')).toBe('west-1');
  });

  it('an engine that declares nothing still gets its own id as the prefix', () => {
    expect(nextLaneSlug(new Set(), 'nobody')).toBe('nobody-1');
  });
});

// ── Which clip the editor shows after a lane switch ────────────────────────

function clip(id: string): SessionClip {
  return { id, name: id, lengthBars: 2, notes: [] } as unknown as SessionClip;
}

/** drums-1 has clips in rows 0 and 1; tb-303-1 only in row 0. */
function makeState(): SessionState {
  return {
    lanes: [
      { id: 'drums-1', engineId: 'drums-machine', name: 'Drums', clips: [clip('d0'), clip('d1')] },
      { id: 'tb-303-1', engineId: 'tb303', name: 'Bass', clips: [clip('b0')] },
    ] as unknown as SessionLane[],
    scenes: [{ id: 's0', name: 'A', clipPerLane: {} }, { id: 's1', name: 'B', clipPerLane: {} }],
  } as unknown as SessionState;
}

describe('clipToShowOnLaneSwitch', () => {
  it('follows the open clip\'s row into the new lane', () => {
    const openClip = { laneId: 'drums-1', clipIdx: 0 };
    expect(clipToShowOnLaneSwitch(makeState(), 'tb-303-1', openClip, -1))
      .toEqual({ laneId: 'tb-303-1', clipIdx: 0 });
  });

  it('returns null when the new lane\'s slot in that row is empty', () => {
    // Row 1 exists in drums but not in the bass lane.
    const openClip = { laneId: 'drums-1', clipIdx: 1 };
    expect(clipToShowOnLaneSwitch(makeState(), 'tb-303-1', openClip, -1)).toBeNull();
  });

  it('falls back to the launched scene\'s row when no clip is open', () => {
    expect(clipToShowOnLaneSwitch(makeState(), 'drums-1', null, 1))
      .toEqual({ laneId: 'drums-1', clipIdx: 1 });
  });

  it('returns null when nothing is open and no scene is launched', () => {
    expect(clipToShowOnLaneSwitch(makeState(), 'drums-1', null, -1)).toBeNull();
  });

  it('returns null for an unknown lane', () => {
    expect(clipToShowOnLaneSwitch(makeState(), 'nope-1', { laneId: 'drums-1', clipIdx: 0 }, -1)).toBeNull();
  });

  it('never adds a clip to the session', () => {
    const state = makeState();
    const before = JSON.stringify(state);
    clipToShowOnLaneSwitch(state, 'tb-303-1', { laneId: 'drums-1', clipIdx: 1 }, -1);
    expect(JSON.stringify(state), 'the state is untouched').toBe(before);
  });
});
