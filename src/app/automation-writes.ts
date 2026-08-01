// Where a value lands when NO knob is mounted — and the rAF loop that needs it.
//
// The cohesion is a single question: given a canonical destination id, WHICH
// audio object does the value reach? Answering it takes the insert-rack scope
// resolution (a lane rack, the master rack, or a send return's rack) plus the
// lane engine lookup, and both callers below need exactly the same answer. They
// are the two halves of one rule — a replay writes the audio object alone, a
// live gesture writes it and mirrors into engineState — so they must not be
// able to drift apart on WHERE the value goes. Keeping the resolution in one
// place is what guarantees that.
//
// The rAF tick travels with them because it is their only consumer on the
// playback side: automationTickDeps.applyUnmounted IS applyUnmountedWrite, and
// getTargetRanges feeds it the declared-range table it denormalises against.
// Splitting the tick from the write it drives would leave two files that only
// make sense read together.
//
// ORDER: createAutomationWrites starts the rAF loop as its last statement, so
// its call site in boot is load-bearing — the loop's first frame must see the
// same world it sees today (sessionHost live, destinations populated, the boot
// demo not yet applied). Keep the call where it is.
//
// The XY pad consumes applyLiveControlUnmountedWrite from ~380 lines EARLIER in
// boot, so main.ts hands it a closure rather than the bare function. The pad
// only reads it inside a click handler, which is why that works.

import type { Sequencer } from '../core/sequencer';
import type { KnobHandle } from '../core/knob';
import type { LaneResourceMap } from '../core/lane-resources';
import type { FxBus } from '../core/fx';
import type { InsertChain } from '../plugins/fx/insert-chain';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionHost } from '../session/session-host';
import type { DestinationRegistry } from '../automation/destination-registry';
import { startAutomationTick, type AutomationTickDeps } from '../automation/automation-tick';
import { applyAutomationToSession } from '../automation/automation-apply';
import { applyLiveControlWrite } from '../automation/live-control-apply';

export interface AutomationWritesDeps {
  /** The master rack — the scope `fx.master` names. */
  masterInsertChain: InsertChain;
  /** Send buses; the scope `fx.send.<id>` resolves to one of their racks. */
  fx: FxBus;
  /** Per-lane racks and engines: every other scope is a lane id. */
  laneResources: LaneResourceMap;
  /** Read at write time for the engineState mirror, and per frame for the lane
   *  play states the envelope tick walks. */
  sessionHost: SessionHost;
  seq: Sequencer;
  ctx: AudioContext;
  automationRegistry: Map<string, KnobHandle>;
  /** The one destination catalogue; its declared min/max are what a normalised
   *  automation value is denormalised against. */
  destinations: DestinationRegistry;
  getLaneEngineInstance(laneId: string): SynthEngine | null;
}

export interface AutomationWrites {
  /** A LIVE gesture on an unmounted target (the XY pad). Hand main.ts a closure
   *  over this, never the bare reference: its consumer is built earlier in boot. */
  applyLiveControlUnmountedWrite(
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ): void;
  /** Playback semantics: the value reaches the audio object and NOTHING else —
   *  no engineState mirror, because a curve belongs to the clip or the take.
   *  Handed to the arrangement player, which had no unmounted path at all. */
  applyPlaybackUnmountedWrite(
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ): void;
  /** The declared min/max of every destination the session offers. */
  targetRanges(): ReadonlyMap<string, { min: number; max: number }>;
}

export function createAutomationWrites(deps: AutomationWritesDeps): AutomationWrites {
  const {
    masterInsertChain, fx, laneResources, sessionHost, seq, ctx,
    automationRegistry, destinations, getLaneEngineInstance,
  } = deps;

  /** The insert rack an automation scope names: a lane, the master bus, or a send
   *  return. Mirrors the scopes `listAutomationTargets` emits. */
  function insertChainFor(scopeId: string) {
    if (scopeId === 'fx.master') return masterInsertChain;
    if (scopeId.startsWith('fx.send.')) {
      const busId = scopeId.slice('fx.send.'.length);
      return fx.sends.find((b) => b.id === busId)?.inserts;
    }
    return laneResources.get(scopeId)?.inserts;
  }

  // How a write with NO mounted knob finds its target: the ONE place the scope
  // resolution (`insertChainFor` / `laneResources`) happens, so the two callers
  // below cannot drift apart on WHERE a value lands.
  function unmountedTargetDeps(ranges: ReadonlyMap<string, { min: number; max: number }>) {
    return {
      getInsertFx: (scopeId: string, slotId: string) =>
        insertChainFor(scopeId)?.list().find((s) => s.id === slotId)?.fx,
      getEngine: (laneId: string) => laneResources.get(laneId)?.engine,
      getRange: (id: string) => ranges.get(id),
    };
  }

  // Playback automation (automationTickDeps.applyUnmounted, below): the value
  // reaches the audio object and NOTHING else. A curve belongs to the clip or to
  // the take, both of which already store it, so it must not become the lane's
  // saved base sound.
  function applyUnmountedWrite(
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ): void {
    applyAutomationToSession(paramId, normalised, unmountedTargetDeps(ranges));
  }

  // A LIVE gesture on an unmounted target (the XY pad — see the xy-open handler):
  // same target, same denormalisation, plus the engineState mirror a mounted
  // knob's onChange would have performed. Without it the pad changed the sound
  // and the save did not record it, purely because that lane's editor was closed
  // — the same asymmetry fe44833 closed for the MIDI surface.
  function applyLiveControlUnmountedWrite(
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ): void {
    applyLiveControlWrite(paramId, normalised, {
      ...unmountedTargetDeps(ranges),
      sessionState: sessionHost.state,
    });
  }

  // The declared min/max of every destination the session offers — the same
  // source the destination picker uses. Shared by the rAF tick's per-frame
  // memo and the arrangement player, so both denormalise against one table.
  const targetRanges = () =>
    new Map(destinations.list().map((t) => [t.id, { min: t.min, max: t.max }]));

  const automationTickDeps: AutomationTickDeps = {
    seq,
    automationRegistry,
    getLaneStates: () => sessionHost.laneStates,
    ctx,
    // Lets the rAF loop read each lane's live modulation offsets for the knob rings.
    getEngineForLane: (laneId) => getLaneEngineInstance(laneId) ?? undefined,
    // An envelope on a lane whose editor is closed has no knob to drive, so it
    // lands on the audio object itself.
    applyUnmounted: applyUnmountedWrite,
    getTargetRanges: targetRanges,
  };

  startAutomationTick(automationTickDeps);

  return {
    applyLiveControlUnmountedWrite,
    applyPlaybackUnmountedWrite: applyUnmountedWrite,
    targetRanges,
  };
}
