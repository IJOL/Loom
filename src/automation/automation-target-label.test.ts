import { describe, it, expect } from 'vitest';
import { automationTargetLabel, type AutomationTarget } from './automation-targets';

const base: AutomationTarget = { id: 'D.kick.tune', laneId: 'D', laneName: 'Drums', label: 'TUNE', min: 0, max: 1 };

describe('automationTargetLabel', () => {
  it('includes the strip when the target has a sub-group', () => {
    expect(automationTargetLabel({ ...base, subGroup: { key: 'kick', label: 'Kick' } }, 'D.kick.tune'))
      .toBe('Drums · Kick · TUNE');
  });
  it('is lane · param for a single-strip target', () => {
    expect(automationTargetLabel({ id: 'P.cutoff', laneId: 'P', laneName: 'Sub', label: 'Cutoff', min: 0, max: 1 }, 'P.cutoff'))
      .toBe('Sub · Cutoff');
  });
  it('falls back to the raw id when the target is gone', () => {
    expect(automationTargetLabel(undefined, 'D.kick.tune')).toBe('D.kick.tune (unavailable)');
  });
});
