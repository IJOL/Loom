import * as leh from '../engines/lane-engine-host';
import type { LaneEngineHostState } from '../engines/lane-engine-host';

export interface LaneHostDeps {
  getSeq(): import('../core/sequencer').Sequencer;
  getBank(): import('../core/pattern').PatternBank;
  getEngineSel(): HTMLSelectElement;
  rebuildEngineParamUI: () => void;
  getLaneLabels(): Record<string, string>;
}

export interface LaneHost {
  state: LaneEngineHostState;
  getLaneEngineId(laneId: string): string;
  setActiveEngineLane(laneId: string): void;
  setLookupEngineId(fn: (laneId: string) => string): void;
}

export function createLaneHost(deps: LaneHostDeps): LaneHost {
  const state = leh.createLaneEngineState();
  let lookup: (laneId: string) => string = () => 'subtractive';

  const hostDeps: import('../engines/lane-engine-host').LaneEngineHostDeps = {
    get seq() { return deps.getSeq(); },
    get bank() { return deps.getBank(); },
    get engineSel() { return deps.getEngineSel(); },
    get rebuildEngineParamUI() { return deps.rebuildEngineParamUI; },
    get laneLabels() { return deps.getLaneLabels(); },
    lookupEngineId: (laneId) => lookup(laneId),
  };

  return {
    state,
    getLaneEngineId: (laneId) => leh.getLaneEngineId(state, hostDeps, laneId),
    setActiveEngineLane: (laneId) => leh.setActiveEngineLane(state, hostDeps, laneId),
    setLookupEngineId: (fn) => { lookup = fn; },
  };
}
