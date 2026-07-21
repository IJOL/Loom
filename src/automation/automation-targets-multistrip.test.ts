// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { listAutomationTargets } from './automation-targets';
// Register the real descriptors so getEngine() finds their params + hooks.
import '../engines/drums-engine';
import '../engines/sampler';
import '../engines/subtractive';
import { emptySessionState, type SessionState } from '../session/session';

function stateWith(lane: unknown): SessionState {
  return { ...emptySessionState(), lanes: [lane] } as SessionState;
}

describe('listAutomationTargets — multi-strip sub-groups', () => {
  it('tags a drum voice param with its voice sub-group; the bus has none', () => {
    const targets = listAutomationTargets(
      stateWith({ id: 'D', name: 'Drums', engineId: 'drums-machine', clips: [], inserts: [] }),
      new Map(),
    );
    const kick = targets.find((t) => t.id === 'D.kick.tune');
    expect(kick?.subGroup).toEqual({ key: 'kick', label: 'Kick' });
    const bus = targets.find((t) => t.id === 'D.bus.level');
    expect(bus?.subGroup).toBeUndefined();
  });

  it('folds sampler per-pad params in from the keymap, tagged by note', () => {
    const targets = listAutomationTargets(
      stateWith({
        id: 'S', name: 'Sampler', engineId: 'sampler', clips: [], inserts: [],
        engineState: { sampler: { keymap: [{ sampleId: 'x', rootNote: 60, loNote: 60, hiNote: 60 }] } },
      }),
      new Map(),
    );
    const tune = targets.find((t) => t.id === 'S.zone60.tune');
    expect(tune?.subGroup).toEqual({ key: 'zone60', label: 'C4' });
    // The continuous filter still applies to dynamic params: discrete pad
    // leaves (loop/retrig/chokeGroup) are not automation destinations.
    expect(targets.some((t) => t.id === 'S.zone60.loop')).toBe(false);
  });

  it('leaves single-strip engine params without a sub-group', () => {
    const targets = listAutomationTargets(
      stateWith({ id: 'P', name: 'Sub', engineId: 'subtractive', clips: [], inserts: [] }),
      new Map(),
    );
    const anyP = targets.find((t) => t.laneId === 'P');
    expect(anyP).toBeDefined();
    expect(anyP!.subGroup).toBeUndefined();
  });
});
