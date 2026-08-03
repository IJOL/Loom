import { describe, it, expect } from 'vitest';
import { nextLaneSlug } from './session-host-util';
import { registerPluginEngine } from '../../test/plugin-fixtures';

// tb303 and subtractive ship as plugins: the equivalent of the old
// side-effect import is that manifest going through the same registerComponent
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
