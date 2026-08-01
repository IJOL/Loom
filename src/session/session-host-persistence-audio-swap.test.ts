// Regression: AudioWorkletEngine used to hardcode `readonly id = 'audio'`, so
// EVERY lane backed by it — including a plugin declaring
// `capabilities.clipContent: 'audio'` under its OWN id — reported the built-in
// engine's id. applyLoadedSessionState's reconciliation
// (`existing.engine.id !== lane.engineId`) then saw e.g. 'audio' !==
// 'audio-probe' on EVERY load and called swapLaneEngine — an unnecessary swap
// on an otherwise idempotent path (see the comment right above that line in
// session-host-persistence.ts). AudioWorkletEngine now takes the real
// engineId in its constructor (mirroring WorkletLaneEngine's cfg.engineId), so
// a lane whose live engine already matches its declared engineId takes the
// ensureLaneResource (no-op) branch instead.
import { describe, it, expect, vi } from 'vitest';
import { applyLoadedSessionState } from './session-host-persistence';
import type { SessionHost } from './session-host';
import type { SessionState } from './session';

const PLUGIN_AUDIO_ENGINE_ID = 'audio-probe-swap-regression';

function makeSess(): SessionState {
  return {
    name: 'Test',
    masterInserts: [],
    musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false },
    sends: [],
    lanes: [{ inserts: [], id: 'plugin-audio-1', engineId: PLUGIN_AUDIO_ENGINE_ID, clips: [] }],
    scenes: [{ id: 's1', name: 'Scene 1', clipPerLane: {} }],
    globalQuantize: '1/1',
  };
}

/** A lane resource whose engine already reports `engineId` as its `.id` — the
 *  post-fix AudioWorkletEngine behaviour (constructed with the real id). */
function makeExistingResource(engineId: string) {
  return {
    engine: { id: engineId, setBaseValue: () => {} },
    strip: undefined,
    inserts: undefined,
  };
}

function makeSelf(over: {
  laneResourceGet: unknown;
  swapLaneEngine: ReturnType<typeof vi.fn>;
  ensureLaneResource: ReturnType<typeof vi.fn>;
}): SessionHost {
  return {
    state: {},
    laneStates: new Map(),
    activeEditLane: null,
    inspector: undefined,
    deps: {
      ctx: {} as AudioContext,
      liveVoices: undefined,
      laneResources: {
        ids: () => ['plugin-audio-1'],
        get: (id: string) => (id === 'plugin-audio-1' ? over.laneResourceGet : undefined),
      },
      swapLaneEngine: over.swapLaneEngine,
      ensureLaneResource: over.ensureLaneResource,
      automationRegistry: new Map(),
      masterInsertChain: undefined,
      fxBus: undefined,
      applyPresetForLane: undefined,
      onDestinationsChanged: vi.fn(),
    },
    renderWithMixer: vi.fn(),
    _fireStateApplied: vi.fn(),
  } as unknown as SessionHost;
}

describe('applyLoadedSessionState — plugin audio-channel engine id reconciliation', () => {
  it('does NOT swap when the live engine already reports the lane\'s real engineId', () => {
    const swapLaneEngine = vi.fn();
    const ensureLaneResource = vi.fn();
    const self = makeSelf({
      laneResourceGet: makeExistingResource(PLUGIN_AUDIO_ENGINE_ID), // post-fix: real id
      swapLaneEngine,
      ensureLaneResource,
    });

    applyLoadedSessionState(self, makeSess());

    expect(swapLaneEngine, 'no unnecessary swap — the ids already match').not.toHaveBeenCalled();
    expect(ensureLaneResource).toHaveBeenCalledWith('plugin-audio-1', PLUGIN_AUDIO_ENGINE_ID);
  });

  it('non-regression: a genuinely stale engine id still triggers a swap', () => {
    const swapLaneEngine = vi.fn();
    const ensureLaneResource = vi.fn();
    const self = makeSelf({
      laneResourceGet: makeExistingResource('some-other-engine'), // deliberately mismatched
      swapLaneEngine,
      ensureLaneResource,
    });

    applyLoadedSessionState(self, makeSess());

    expect(swapLaneEngine).toHaveBeenCalledWith('plugin-audio-1', PLUGIN_AUDIO_ENGINE_ID);
    expect(ensureLaneResource).not.toHaveBeenCalled();
  });
});
