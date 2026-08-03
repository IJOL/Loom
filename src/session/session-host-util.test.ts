import { describe, it, expect } from 'vitest';
import { nextLaneSlug } from './session-host-util';
import '../engines/tb303';
import '../engines/subtractive';
import '../engines/fm';
import '../engines/wavetable';
import '../engines/westcoast';

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
