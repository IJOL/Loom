// Releasing the desk. ONE function, and every route that replaces the session
// runs it first — New, the boot demo, the demo picker, a save/autosave load, an
// import that replaces.
//
// WHY it exists: applying a session only ever PUSHED the fields the incoming
// JSON happened to carry. Nothing carries a per-lane `mixer` except a save, and
// `ensureLaneResource` is idempotent, so a lane id that appeared in both the old
// and the new state kept its live ChannelStrip — level, pan, EQ, both sends,
// mute, compressor and sidechain rode straight through New and through every
// demo switch. The same silence covered the master rack, the send buses, the
// master processors, mute/solo and the per-lane note-FX chains: state that the
// new session does not mention is state the old session keeps.
//
// The fix is not a longer list of restores at the apply site — that list would
// go stale the next time something joins the desk. It is this: a load starts
// from a released desk. Anything the new state does not set is therefore at its
// constructed default, never at the previous session's value.
//
// What deliberately does NOT reset here: the master VOLUME fader. It is the
// listening level of the room, not a property of the song — resetting it would
// change how loud the speakers are when the user presses New.

import type { SessionHost } from './session-host';
import { clearNoteFxChains } from '../notefx/notefx-registry';
import { pruneKnobRegistry, pruneKnobRegistryToDestinations } from '../app/knob-registry-prune';
import { DEFAULT_COMP_STATE } from '../core/comp-state';
import { MASTER_SHAPER_DEFAULTS } from '../core/master-shaper';
import { defaultSends } from '../core/send-migration';
import type { InsertChain } from '../core/insert-chain';

function emptyRack(chain: InsertChain | undefined): void {
  if (!chain) return;
  while (chain.size() > 0) chain.remove(0);
}

/** Free one lane through the allocator when there is one (it also drops the
 *  cached voice, any standalone strip and the voice-cap entry), falling back to
 *  the bare resource map for fixtures that have no allocator. Exported so the
 *  load path's "lanes that vanished" sweep frees exactly as much. */
export function releaseLane(self: SessionHost, laneId: string): void {
  if (self.deps.releaseLane) self.deps.releaseLane(laneId);
  else self.deps.laneResources?.dispose(laneId);
}

/** Release EVERY live resource this session holds, back to a virgin desk.
 *  Called by {@link SessionHost.replaceSession} before applying any new state —
 *  never call it and then leave the host without one, since it deliberately
 *  leaves zero lanes allocated. */
export function resetAllResources(self: SessionHost): void {
  const d = self.deps;

  // Voices first: a still-sounding 'audio' clip holds a buffer source that
  // nobody else stops, and disposing its lane below would strand it audible.
  d.liveVoices?.silenceAll(d.ctx.currentTime);

  // Lanes: strip + engine + insert chain + the allocator's own per-lane caches,
  // for every lane without exception. This is what makes a reused lane id land
  // on a FRESH ChannelStrip.
  for (const id of d.laneResources?.ids() ?? []) releaseLane(self, id);
  self.laneStates.clear();

  // Per-lane note-FX chains live in a module registry keyed by lane id, so they
  // outlive their lane exactly like the strips did.
  clearNoteFxChains();

  // Racks: master, then both send buses.
  emptyRack(d.masterInsertChain);
  if (d.fxBus) {
    const defaults = defaultSends();
    for (const bus of d.fxBus.sends) {
      const def = defaults.find((b) => b.id === bus.id);
      bus.label = def?.label ?? bus.label;
      bus.setMuted(false);
      bus.setReturnLevel(def?.returnLevel ?? 1);
      emptyRack(bus.inserts);
    }
  }

  // Knob handles: every lane-scoped one dies with its lane, and with all three
  // rack kinds now empty, every insert-param handle is stale too (those are
  // global-scoped, so the lane prune alone never touched them).
  pruneKnobRegistry(d.automationRegistry, new Set<string>());
  pruneKnobRegistryToDestinations(d.automationRegistry, new Set<string>());

  // Master processing chain. NOT the master volume — see the header.
  d.masterStrip?.restore({ eqLow: 0, eqMid: 0, eqHigh: 0, pan: 0, muted: false });
  d.masterComp?.setState(DEFAULT_COMP_STATE);
  d.masterShaper?.setState(MASTER_SHAPER_DEFAULTS);

  // Mute/solo are held as records keyed by track id, outside any lane; left
  // alone, a muted lane came back muted in the next session.
  const mix = d.mixerDeps as { muteState?: Record<string, boolean>; soloState?: Record<string, boolean> } | undefined;
  for (const k of Object.keys(mix?.muteState ?? {})) mix!.muteState![k] = false;
  for (const k of Object.keys(mix?.soloState ?? {})) mix!.soloState![k] = false;
}
