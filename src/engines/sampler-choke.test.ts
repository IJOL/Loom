// Pure choke logic for the worklet Sampler — the truth table the processor and
// engine consume. Mirrors src/core/drums-choke.test.ts (chokeGroupMates) but for
// note-identified pads + the mono (retrig) self-cut.
import { describe, it, expect } from 'vitest';
import { defaultChokeGroup, chokesVoice } from './sampler-choke';

describe('defaultChokeGroup', () => {
  it('GM hi-hats (42 closed, 44 pedal, 46 open) default to group 1 on a drumkit', () => {
    for (const n of [42, 44, 46]) expect(defaultChokeGroup(n, true)).toBe(1);
  });

  it('non-hat notes default to 0 on a drumkit', () => {
    for (const n of [36, 38, 50, 56]) expect(defaultChokeGroup(n, true)).toBe(0);
  });

  it('never applies the hat default when the lane is not a drumkit', () => {
    // A melodic zone whose root lands on 46 must NOT silently become mono.
    for (const n of [42, 44, 46]) expect(defaultChokeGroup(n, false)).toBe(0);
  });
});

describe('chokesVoice', () => {
  it('cuts a live voice sharing its non-zero group (CH cuts a ringing OH)', () => {
    expect(chokesVoice({ chokeGroup: 1, padNote: 42, retrig: 0 }, { chokeGroup: 1, padNote: 46 })).toBe(true);
  });

  it('group 0 never chokes', () => {
    expect(chokesVoice({ chokeGroup: 0, padNote: 36, retrig: 0 }, { chokeGroup: 0, padNote: 38 })).toBe(false);
  });

  it('different non-zero groups do not cross-choke', () => {
    expect(chokesVoice({ chokeGroup: 1, padNote: 42, retrig: 0 }, { chokeGroup: 2, padNote: 50 })).toBe(false);
  });

  it("group choke includes the pad's own prior ring (same group, same pad)", () => {
    expect(chokesVoice({ chokeGroup: 1, padNote: 42, retrig: 0 }, { chokeGroup: 1, padNote: 42 })).toBe(true);
  });

  it('mono retrig self-cuts the same pad even with no group', () => {
    expect(chokesVoice({ chokeGroup: 0, padNote: 60, retrig: 1 }, { chokeGroup: 0, padNote: 60 })).toBe(true);
  });

  it('mono retrig does NOT cut a different pad', () => {
    expect(chokesVoice({ chokeGroup: 0, padNote: 60, retrig: 1 }, { chokeGroup: 0, padNote: 62 })).toBe(false);
  });

  it('poly (retrig 0) lets the same pad stack', () => {
    expect(chokesVoice({ chokeGroup: 0, padNote: 60, retrig: 0 }, { chokeGroup: 0, padNote: 60 })).toBe(false);
  });

  it('audio-clip slots (padNote -1, group 0) are never choked', () => {
    expect(chokesVoice({ chokeGroup: 1, padNote: 42, retrig: 1 }, { chokeGroup: 0, padNote: -1 })).toBe(false);
  });
});
