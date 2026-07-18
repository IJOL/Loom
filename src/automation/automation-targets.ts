// The automation destination catalogue.
//
// Destinations are DERIVED from the SessionState — the lanes that exist and the
// inserts they declare — not scraped from the live knob registry. The registry
// is a UI-lifetime map: an entry appears when a panel mounts and (except for the
// engine-swap prefix purge) never leaves. Reading it as a catalogue produced two
// bugs: ghost instruments surviving a session load, and inserts that were
// invisible until you opened their lane's editor.
//
// The registry is still consulted, but only to LABEL a target: when a knob for
// the id happens to be mounted its label/range win, since that is what the user
// sees on screen. Everything else comes from the declared schema.

import { getEngine } from '../engines/registry';
import { getPlugin } from '../plugins/registry';
import type { SessionState } from '../session/session';
import type { KnobHandle } from '../core/knob';

export interface AutomationTarget {
  /** Canonical param id: `<laneId>.<engineParam>` or `<laneId>.fx<slot>.<param>`. */
  id: string;
  label: string;
  laneId: string;
  laneName: string;
  min: number;
  max: number;
}

/** The insert-param id for a rack slot. `scopeId` is a lane id, or `fx.master` /
 *  `fx.send.<id>` for the global racks. Single source of truth — knob
 *  registration, the picker, and playback resolution all go through it. */
export function insertParamId(scopeId: string, slotIdx: number, paramId: string): string {
  return `${scopeId}.fx${slotIdx}.${paramId}`;
}

/** Continuous params an fx plugin declares. Non-fx plugin kinds (note-FX) carry
 *  no param manifest, so they contribute nothing. */
function fxParams(pluginId: string) {
  const plugin = getPlugin('fx', pluginId);
  if (!plugin || plugin.kind !== 'fx') return [];
  return plugin.manifest.params.filter((p) => p.kind === 'continuous');
}

/** Every automatable destination the session declares, in lane order: each
 *  lane's continuous engine params first, then its inserts slot by slot. */
export function listAutomationTargets(
  state: SessionState,
  registry: ReadonlyMap<string, KnobHandle>,
): AutomationTarget[] {
  const targets: AutomationTarget[] = [];

  for (const lane of state.lanes) {
    const laneName = lane.name || lane.id;

    // A live knob, when mounted, is the authority on how the param reads.
    const push = (id: string, label: string, min: number, max: number) => {
      const live = registry.get(id);
      targets.push({
        id,
        laneId: lane.id,
        laneName,
        label: live?.meta.label ?? label,
        min: live?.meta.min ?? min,
        max: live?.meta.max ?? max,
      });
    };

    const engine = getEngine(lane.engineId);
    for (const spec of engine?.params ?? []) {
      if (spec.kind !== 'continuous') continue;
      push(`${lane.id}.${spec.id}`, spec.label, spec.min, spec.max);
    }

    (lane.inserts ?? []).forEach((slot, idx) => {
      for (const spec of fxParams(slot.pluginId)) {
        push(insertParamId(lane.id, idx, spec.id), spec.label, spec.min, spec.max);
      }
    });
  }

  // The global racks are destinations too, grouped under their own headings.
  pushRackTargets(targets, registry, 'fx.master', 'Master', state.masterInserts ?? []);
  for (const send of state.sends ?? []) {
    pushRackTargets(targets, registry, `fx.send.${send.id}`, `Send ${send.label || send.id}`, send.inserts ?? []);
  }

  return targets;
}

/** Append one non-lane insert rack (master, or a send return) to `targets`. */
function pushRackTargets(
  targets: AutomationTarget[],
  registry: ReadonlyMap<string, KnobHandle>,
  scopeId: string,
  displayName: string,
  slots: readonly { pluginId: string }[],
): void {
  slots.forEach((slot, idx) => {
    for (const spec of fxParams(slot.pluginId)) {
      const id = insertParamId(scopeId, idx, spec.id);
      const live = registry.get(id);
      targets.push({
        id,
        laneId: scopeId,
        laneName: displayName,
        label: live?.meta.label ?? spec.label,
        min: live?.meta.min ?? spec.min,
        max: live?.meta.max ?? spec.max,
      });
    }
  });
}

/** Group targets by lane for a picker's <optgroup>s, in session lane order. */
export function groupTargetsByLane(targets: AutomationTarget[]): Map<string, AutomationTarget[]> {
  const groups = new Map<string, AutomationTarget[]>();
  for (const t of targets) {
    let g = groups.get(t.laneName);
    if (!g) { g = []; groups.set(t.laneName, g); }
    g.push(t);
  }
  return groups;
}
