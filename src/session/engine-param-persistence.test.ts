/** @vitest-environment jsdom */
// Regression: a knob turned on ANY worklet-engine lane must survive a save.
// `engineState.params` is the only vehicle that carries a knob value into a
// SavedState, and the grid builder used to skip the mirror entirely — so an
// FM / Wavetable / Karplus / Westcoast / TB-303 tweak was thrown away on
// reload while the identical tweak on a Subtractive lane survived.

import { describe, it, expect } from 'vitest';

// Side-effect imports so getEngine() answers with the real param specs.
import '../engines/subtractive';
import '../engines/wavetable';
import '../engines/fm';
import '../engines/tb303';
import '../engines/westcoast';

import { getEngine } from '../engines/registry';
import { buildEngineParamGrid } from '../engines/engine-param-grid';
import { SessionHost } from './session-host';
import { fakeDestinations } from './fake-destinations';
import type { EngineParamSpec } from '../engines/engine-params';
import type { EngineUIContext } from '../engines/engine-types';
import type { KnobHandle } from '../core/knob';

function makeHost(): SessionHost {
  const laneResources = { get: () => undefined, ids: () => [], dispose: () => {} };
  return new SessionHost(
    { laneResources, destinations: fakeDestinations() } as unknown as ConstructorParameters<typeof SessionHost>[0],
  );
}

/** Half-way from the spec default towards its farther bound — always a value
 *  the knob can reach and that differs from the default, whatever the range. */
function awayFromDefault(spec: EngineParamSpec): number {
  return (spec.max - spec.default) >= (spec.default - spec.min)
    ? spec.default + (spec.max - spec.default) / 2
    : spec.default - (spec.default - spec.min) / 2;
}

const ENGINE_IDS = ['fm', 'wavetable', 'westcoast', 'tb303', 'subtractive'] as const;

describe('a knob turned on a worklet-engine lane survives getStateForSave', () => {
  it.each(ENGINE_IDS)('%s', (engineId) => {
    const host = makeHost();
    const laneId = `${engineId}-1`;
    host.state.lanes = [{ inserts: [], id: laneId, engineId, clips: [] }];

    const engine = getEngine(engineId);
    expect(engine, `getEngine('${engineId}') returned undefined`).toBeDefined();

    const reg = new Map<string, KnobHandle>();
    const ctx = {
      laneId,
      registerKnob: (k: KnobHandle) => { if (k.meta?.id) reg.set(k.meta.id, k); },
      registry: reg,
      sessionState: host.state,
    } as unknown as EngineUIContext;

    // Each lane's REAL builder, now one function with two layouts:
    // knob-mounting.mountSubtractiveLaneKnobs asks for the flat one, every
    // other worklet engine gets the grouped grid.
    const parent = document.createElement('div');
    buildEngineParamGrid(engine!, ctx, parent,
      engineId === 'subtractive' ? { layout: 'flat' } : {});

    const spec = engine!.params.find((p) => p.kind === 'continuous' && p.max > p.min);
    expect(spec, `${engineId} declares no continuous param to turn`).toBeDefined();
    const handle = reg.get(`${laneId}.${spec!.id}`);
    expect(handle, `${engineId} did not register ${laneId}.${spec!.id}`).toBeDefined();

    handle!.setValue(awayFromDefault(spec!));

    const saved = host.getStateForSave();
    const lane = saved.lanes.find((l) => l.id === laneId)!;
    const persisted = lane.engineState?.params?.[spec!.id];

    expect(persisted, `${engineId}: the knob edit never reached the save`).toBeDefined();
    expect(persisted).not.toBe(spec!.default);
  });
});
