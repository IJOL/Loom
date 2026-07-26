// The mixer column's seven controls must be automation destinations on EVERY
// lane, not just on a drum lane.
//
// The catalogue derives destinations from `engine.params`, so "is my lane's
// LEVEL automatable?" reduces to "does this lane's engine declare bus.level?".
// Drums did; the other eight did not, which is the whole reported bug: right
// clicking a mixer EQ knob produced no menu because the id was in no catalogue.
//
// The declaration therefore happens in createDescriptorEngine — one place every
// engine descriptor goes through — rather than being copied into nine files
// where the tenth engine would forget it.
import { describe, it, expect } from 'vitest';
import { listAutomationTargets } from './automation-targets';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import { registerEngine } from '../engines/registry';
import { STRIP_PARAM_SPECS } from '../core/channel-strip-params';
import type { EngineParamSpec } from '../engines/engine-params';
import { emptySessionState, type SessionState } from '../session/session';

const STRIP_IDS = STRIP_PARAM_SPECS.map((s) => s.id);

// The engine registry has no reset hook, and re-registering an id warns and
// overwrites. A fresh id per test keeps the runs independent and the output
// clean.
let seq = 0;
const nextEngineId = () => `test-strip-dest-${++seq}`;

const CUTOFF: EngineParamSpec = {
  id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous', min: 0, max: 1, default: 0.5,
};

function descriptor(id: string, params: EngineParamSpec[] = [CUTOFF]) {
  return createDescriptorEngine({
    id, name: 'Test Engine', polyphony: 'poly', params, presets: () => [],
  });
}

function sessionWithLane(engineId: string): SessionState {
  return {
    ...emptySessionState(),
    lanes: [{ id: 'L1', name: 'Lead', engineId, clips: [], inserts: [] }],
  };
}

describe('createDescriptorEngine', () => {
  it('appends the seven strip params to whatever the engine declares', () => {
    const eng = descriptor(nextEngineId());
    const ids = eng.params.map((p) => p.id);
    expect(ids).toContain('filter.cutoff');
    for (const id of STRIP_IDS) expect(ids).toContain(id);
  });

  it('does not duplicate them when the engine already declares them', () => {
    // Drums declares the seven itself (its knobs and saved sessions predate this
    // file). A second copy would list every mixer param twice in every picker.
    const eng = descriptor(nextEngineId(), [CUTOFF, ...STRIP_PARAM_SPECS.map((s) => ({ ...s }))]);
    const ids = eng.params.map((p) => p.id);
    for (const id of STRIP_IDS) {
      expect(ids.filter((x) => x === id)).toHaveLength(1);
    }
  });

  it('serves a default for a strip param it did not originally declare', () => {
    // getBaseValue seeds from cfg.params; a strip param appended afterwards must
    // still answer, or a knob built from the catalogue reads 0 for LEVEL.
    const eng = descriptor(nextEngineId());
    expect(eng.getBaseValue('bus.level')).toBe(1);
    expect(eng.getBaseValue('bus.pan')).toBe(0);
  });
});

describe('listAutomationTargets with the strip params', () => {
  it('emits the seven for a lane whose engine is not drums', () => {
    const engineId = nextEngineId();
    registerEngine(descriptor(engineId));
    const targets = listAutomationTargets(sessionWithLane(engineId), new Map());
    const ids = targets.map((t) => t.id);
    for (const id of STRIP_IDS) expect(ids).toContain(`L1.${id}`);
  });

  it('carries the declared range, so a 0..1 envelope maps to real units', () => {
    const engineId = nextEngineId();
    registerEngine(descriptor(engineId));
    const targets = listAutomationTargets(sessionWithLane(engineId), new Map());
    const level = targets.find((t) => t.id === 'L1.bus.level');
    expect(level).toMatchObject({ min: 0, max: 1.5, laneId: 'L1', laneName: 'Lead' });
  });

  it('leaves the seven ungrouped, so they read as the lane own mixer', () => {
    // drum-subgroups already settled this: bus params belong to no voice and no
    // pad, so they must not be filed under a per-voice sub-heading.
    const engineId = nextEngineId();
    registerEngine(descriptor(engineId));
    const targets = listAutomationTargets(sessionWithLane(engineId), new Map());
    for (const id of STRIP_IDS) {
      expect(targets.find((t) => t.id === `L1.${id}`)!.subGroup).toBeUndefined();
    }
  });
});
