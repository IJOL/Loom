import { describe, it, expect } from 'vitest';
import { groupTargetsByLane, type AutomationTarget } from './automation-targets';

const t = (id: string, laneName: string, label: string, sub?: { key: string; label: string }): AutomationTarget => ({
  id, laneId: 'x', laneName, label, min: 0, max: 1, ...(sub ? { subGroup: sub } : {}),
});

describe('groupTargetsByLane with sub-groups', () => {
  it('splits a multi-strip lane into one header per sub-group', () => {
    const groups = groupTargetsByLane([
      t('D.bus.level', 'Drums', 'Vol'),
      t('D.kick.tune', 'Drums', 'TUNE', { key: 'kick', label: 'Kick' }),
      t('D.clap.tone', 'Drums', 'TONE', { key: 'clap', label: 'Clap' }),
    ]);
    expect([...groups.keys()]).toEqual(['Drums', 'Drums · Kick', 'Drums · Clap']);
    expect(groups.get('Drums · Kick')!.map((x) => x.label)).toEqual(['TUNE']);
  });

  it('does not merge same-named sub-groups across two lanes', () => {
    const groups = groupTargetsByLane([
      t('D1.kick.tune', 'Drums 1', 'TUNE', { key: 'kick', label: 'Kick' }),
      t('D2.kick.tune', 'Drums 2', 'TUNE', { key: 'kick', label: 'Kick' }),
    ]);
    expect([...groups.keys()]).toEqual(['Drums 1 · Kick', 'Drums 2 · Kick']);
  });

  it('leaves single-strip targets grouped by lane name alone', () => {
    const groups = groupTargetsByLane([t('P.cutoff', 'Sub 1', 'Cutoff')]);
    expect([...groups.keys()]).toEqual(['Sub 1']);
  });
});
