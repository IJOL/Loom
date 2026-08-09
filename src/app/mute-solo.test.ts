// Soloing a lane appeared to take the master to silence, twice, while measuring
// something else. The pure arithmetic is covered in core/mute-solo.test.ts and
// is fine; what had no test is THIS layer — the one that decides which strips a
// lane owns and actually calls setMuted on each. A solo that muted the lane it
// was soloing would be invisible to the maths and audible immediately.
import { describe, it, expect } from 'vitest';
import { createMuteSolo } from './mute-solo';
import type { LaneResourceMap } from '../core/lane-resources';
import type { ChannelStrip } from '../core/fx';

function harness(laneIds: string[]) {
  const muted: Record<string, boolean> = {};
  const strips = new Map<string, ChannelStrip>();
  const stripFor = (id: string) => {
    let s = strips.get(id);
    if (!s) {
      s = { setMuted: (v: boolean) => { muted[id] = v; } } as unknown as ChannelStrip;
      strips.set(id, s);
    }
    return s;
  };
  const ms = createMuteSolo({
    laneResources: { ids: () => laneIds } as unknown as LaneResourceMap,
    stripFor,
    allTrackIds: laneIds,
  });
  return { ms, muted };
}

describe('createMuteSolo', () => {
  it('leaves every strip audible when nothing is soloed or muted', () => {
    const h = harness(['tb-303-1', 'drums-1', 'sub-1']);
    h.ms.apply();
    expect(Object.values(h.muted).every((v) => v === false)).toBe(true);
  });

  it('carries a lane\'s OWNED track ids with it, alias and drum voices alike', () => {
    // The lane ids the session uses ARE the ones lane-ids.ts calls legacy, so a
    // 303 lane drags `bass` along and a drums lane drags its bus and all eight
    // voices. A solo that moved the lane strip and left those behind would mute
    // the drum voices under an audible bus — the regression computeStripMutes
    // exists to prevent, wired here.
    const h = harness(['tb-303-1', 'drums-1']);
    h.ms.soloState['drums-1'] = true;
    h.ms.apply();
    expect(h.muted['drumBus']).toBe(false);
    expect(h.muted['kick']).toBe(false);
    expect(h.muted['bass']).toBe(true);      // the 303's alias follows its lane
  });

  it('soloing one lane leaves THAT lane audible and silences the rest', () => {
    const h = harness(['tb-303-1', 'drums-1', 'sub-1']);
    h.ms.soloState['drums-1'] = true;
    h.ms.apply();
    expect(h.muted['drums-1']).toBe(false);
    expect(h.muted['tb-303-1']).toBe(true);
    expect(h.muted['sub-1']).toBe(true);
  });

  it('writes a decision for EVERY lane, so none is left at its last value', () => {
    // The failure mode that would read as "solo kills the master": one strip
    // silently skipped, keeping a mute from an earlier gesture.
    const h = harness(['tb-303-1', 'drums-1', 'sub-1']);
    h.ms.muteState['sub-1'] = true;
    h.ms.apply();
    h.ms.muteState['sub-1'] = false;
    h.ms.soloState['tb-303-1'] = true;
    h.ms.apply();
    for (const id of ['tb-303-1', 'drums-1', 'sub-1']) expect(h.muted).toHaveProperty(id);
    expect(h.muted['tb-303-1']).toBe(false);
    expect(h.muted['sub-1']).toBe(true);     // silenced by the solo, not left muted
  });

  it('un-soloing gives every lane its voice back', () => {
    const h = harness(['tb-303-1', 'drums-1']);
    h.ms.soloState['drums-1'] = true;
    h.ms.apply();
    h.ms.soloState['drums-1'] = false;
    h.ms.apply();
    expect(h.muted['tb-303-1']).toBe(false);
    expect(h.muted['drums-1']).toBe(false);
  });

  it('two solos keep both audible', () => {
    const h = harness(['tb-303-1', 'drums-1', 'sub-1']);
    h.ms.soloState['drums-1'] = true;
    h.ms.soloState['sub-1'] = true;
    h.ms.apply();
    expect(h.muted['drums-1']).toBe(false);
    expect(h.muted['sub-1']).toBe(false);
    expect(h.muted['tb-303-1']).toBe(true);
  });
});
