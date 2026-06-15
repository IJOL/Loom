import { describe, it, expect } from 'vitest';
import { chokeGroupMates, DRUM_LANES, type DrumVoice, type DrumSynthState } from './drums';

// Build a synth state where each voice carries only the chokeGroup leaf we care
// about (the helper reads `chokeGroup`, defaulting absent/0 to "no group").
function synthWith(groups: Partial<Record<DrumVoice, number>>): DrumSynthState {
  const s = {} as DrumSynthState;
  for (const v of DRUM_LANES) s[v] = { chokeGroup: groups[v] ?? 0 };
  return s;
}

describe('chokeGroupMates', () => {
  it('default hi-hat group: CH and OH choke each other', () => {
    const s = synthWith({ closedHat: 1, openHat: 1 });
    expect(chokeGroupMates(s, 'closedHat').sort()).toEqual(['closedHat', 'openHat']);
    expect(chokeGroupMates(s, 'openHat').sort()).toEqual(['closedHat', 'openHat']);
  });

  it('a voice with no group (0) chokes nothing', () => {
    const s = synthWith({ closedHat: 1, openHat: 1 }); // kick is 0
    expect(chokeGroupMates(s, 'kick')).toEqual([]);
  });

  it('general: any voices sharing a non-zero group are mutually exclusive', () => {
    const s = synthWith({ kick: 2, tom: 2, snare: 3 });
    expect(chokeGroupMates(s, 'kick').sort()).toEqual(['kick', 'tom']);
    expect(chokeGroupMates(s, 'tom').sort()).toEqual(['kick', 'tom']);
    expect(chokeGroupMates(s, 'snare')).toEqual(['snare']); // alone in group 3
  });

  it('different groups do not choke across', () => {
    const s = synthWith({ closedHat: 1, openHat: 1, kick: 2, tom: 2 });
    expect(chokeGroupMates(s, 'closedHat')).not.toContain('kick');
    expect(chokeGroupMates(s, 'kick')).not.toContain('openHat');
  });
});
