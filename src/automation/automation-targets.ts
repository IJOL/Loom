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
import { WEAVE_MACROS, WEAVE_SCOPE, macroDestinationId } from '../weave/weave-catalog';
import type { SessionState } from '../session/session';
import type { KnobHandle } from '../core/knob';

export interface AutomationTarget {
  /** Canonical param id: `<laneId>.<engineParam>` or `<laneId>.fx:<slotId>.<param>`. */
  id: string;
  label: string;
  laneId: string;
  laneName: string;
  min: number;
  max: number;
  /** Optional sub-heading within a lane: a drum voice, a sampler pad. Absent for
   *  single-strip engines, which group by lane alone as before. Presentation
   *  only — computed at list time, never persisted. */
  subGroup?: { key: string; label: string };
}

/** The insert-param id for a rack slot. `scopeId` is a lane id, or `fx.master` /
 *  `fx.send.<id>` for the global racks. `slotId` is the slot's stable id, never
 *  its position — position changes when a neighbour is removed. Single source
 *  of truth — knob registration, the picker, and playback resolution all go
 *  through it. */
export function insertParamId(scopeId: string, slotId: string, paramId: string): string {
  return `${scopeId}.fx:${slotId}.${paramId}`;
}

/** Continuous params an fx plugin declares. Non-fx plugin kinds (note-FX) carry
 *  no param manifest, so they contribute nothing. */
function fxParams(pluginId: string) {
  const plugin = getPlugin('fx', pluginId);
  if (!plugin || plugin.kind !== 'fx') return [];
  return plugin.manifest.params.filter((p) => p.kind === 'continuous');
}

/** An fx plugin's display name, falling back to its id. */
function fxPluginName(pluginId: string): string {
  const plugin = getPlugin('fx', pluginId);
  return plugin && plugin.kind === 'fx' ? plugin.manifest.name : pluginId;
}

/** Per-slot sub-group for a rack of inserts, keyed by the slot's stable id: the
 *  plugin's display name, numbered ("Delay 1", "Delay 2") when that plugin
 *  appears more than once in the rack so two of the same insert don't collapse
 *  into one heading. Each insert's params thus sit under their own sub-heading
 *  ("<scope> · <plugin>"), not lumped under the bare lane/rack name. */
function insertSubGroups(
  slots: readonly { id: string; pluginId: string }[],
): Map<string, { key: string; label: string }> {
  const total = new Map<string, number>();
  for (const s of slots) {
    const n = fxPluginName(s.pluginId);
    total.set(n, (total.get(n) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const out = new Map<string, { key: string; label: string }>();
  for (const s of slots) {
    const n = fxPluginName(s.pluginId);
    let label = n;
    if ((total.get(n) ?? 0) > 1) {
      const idx = (seen.get(n) ?? 0) + 1;
      seen.set(n, idx);
      label = `${n} ${idx}`;
    }
    out.set(s.id, { key: s.id, label });
  }
  return out;
}

/** Every automatable destination the session declares, in lane order: each
 *  lane's continuous engine params first, then its inserts slot by slot. */
export function listAutomationTargets(
  state: SessionState,
  registry: ReadonlyMap<string, KnobHandle>,
): AutomationTarget[] {
  // The WEAVE macros belong to the SESSION, not to a lane, so they are listed
  // before anything lane-shaped and do not depend on a lane existing at all.
  //
  // AutomationTarget has no `group` field — the pickers group by laneName
  // through groupTargetsByLane, which is a plain string key and never looks a
  // lane up. So the macros travel as a pseudo-lane: the scope id is their
  // laneId, and "Weave" is the heading the user sees.
  const targets: AutomationTarget[] = WEAVE_MACROS.map((m) => ({
    id: macroDestinationId(m.id),
    label: m.label,
    laneId: WEAVE_SCOPE,
    laneName: 'Weave',
    min: 0,
    max: 1,
  }));

  for (const lane of state.lanes) {
    const laneName = lane.name || lane.id;

    // A live knob, when mounted, is the authority on how the param reads.
    // `prefix` goes ON TOP of that authority: it exists to tell two same-label
    // params apart, and the mounted knob carries the bare colliding label.
    const push = (
      id: string, label: string, min: number, max: number,
      subGroup?: { key: string; label: string },
      prefix?: string,
    ) => {
      const live = registry.get(id);
      const base = live?.meta.label ?? label;
      targets.push({
        id,
        laneId: lane.id,
        laneName,
        label: prefix ? `${prefix} · ${base}` : base,
        min: live?.meta.min ?? min,
        max: live?.meta.max ?? max,
        ...(subGroup ? { subGroup } : {}),
      });
    };

    const engine = getEngine(lane.engineId);
    // Static params + any per-lane dynamic params the engine derives from the
    // session (the sampler's per-pad params, from the lane keymap). The engine
    // owns both the sub-group naming and the dynamic list — the catalogue never
    // learns what a voice or a pad is.
    const engineSpecs = [...(engine?.params ?? []), ...(engine?.dynamicParamsFor?.(lane) ?? [])]
      .filter((spec) => spec.kind === 'continuous')
      .map((spec) => ({ spec, subGroup: engine?.subGroupFor?.(spec.id) }));

    // One engine may label two params identically — the Subtractive has a
    // "Cutoff" in FILTER A and another in FILTER B — and a flat picker showed
    // them as two indistinguishable rows. A COLLIDING label is prefixed with
    // its group's title; a unique one stays bare, because prefixing everything
    // would bury the signal it exists to give.
    //
    // The census runs PER SUB-GROUP, not per engine: a heading (a drum voice,
    // a sampler pad, a rack slot) already tells its members apart from every
    // other heading's, so eight drum Tunes are no collision at all — while the
    // two filters of one Subtractive SLOT still are, under one heading. The
    // group table includes the DYNAMIC groups (a rack derives its slot
    // engines' sections per lane), or a LAYERS slot's cutoffs would have no
    // title to be prefixed with.
    const labelCount = new Map<string, number>();
    const bucket = (e: (typeof engineSpecs)[number]) => `${e.subGroup?.key ?? ''}|${e.spec.label}`;
    for (const e of engineSpecs) {
      labelCount.set(bucket(e), (labelCount.get(bucket(e)) ?? 0) + 1);
    }
    const groupTable = [...(engine?.groups ?? []), ...(engine?.dynamicGroupsFor?.(lane) ?? [])];
    for (const e of engineSpecs) {
      const prefix = (labelCount.get(bucket(e)) ?? 0) > 1
        ? groupTable.find((g) => g.id === e.spec.group)?.title
        : undefined;
      push(`${lane.id}.${e.spec.id}`, e.spec.label, e.spec.min, e.spec.max, e.subGroup, prefix);
    }

    // A modulator's DEPTH is an automatable value like any other, and until now
    // it was the one the catalogue did not offer — which is why WEAVE's Motion
    // macro, which addresses destinations whose id ends in `.depth`, wrote to
    // nothing at all. The id is the one the modulation panel's own knob already
    // registers, so a mounted knob and an automation lane address the same
    // thing rather than two.
    for (const mod of lane.engineState?.modulators ?? []) {
      for (const conn of mod.connections ?? []) {
        push(
          `${lane.id}.mod.${mod.id}.conn.${conn.id}.depth`,
          `→ ${conn.paramId}`,
          -1, 1,
          { key: `mod:${mod.id}`, label: mod.id.toUpperCase() },
        );
      }
    }

    const laneInsertSubs = insertSubGroups(lane.inserts);
    lane.inserts.forEach((slot) => {
      const subGroup = laneInsertSubs.get(slot.id);
      for (const spec of fxParams(slot.pluginId)) {
        push(insertParamId(lane.id, slot.id, spec.id), spec.label, spec.min, spec.max, subGroup);
      }
    });
  }

  // The global racks are destinations too, grouped under their own headings.
  pushRackTargets(targets, registry, 'fx.master', 'Master', state.masterInserts);
  for (const send of state.sends) {
    // The bus label already reads "Send A (Delay)" — don't prefix it again.
    pushRackTargets(targets, registry, `fx.send.${send.id}`, send.label || `Send ${send.id}`, send.inserts);
  }

  return targets;
}

/** Append one non-lane insert rack (master, or a send return) to `targets`. */
function pushRackTargets(
  targets: AutomationTarget[],
  registry: ReadonlyMap<string, KnobHandle>,
  scopeId: string,
  displayName: string,
  slots: readonly { id: string; pluginId: string }[],
): void {
  const subs = insertSubGroups(slots);
  for (const slot of slots) {
    const subGroup = subs.get(slot.id);
    for (const spec of fxParams(slot.pluginId)) {
      const id = insertParamId(scopeId, slot.id, spec.id);
      const live = registry.get(id);
      targets.push({
        id, laneId: scopeId, laneName: displayName,
        label: live?.meta.label ?? spec.label,
        min: live?.meta.min ?? spec.min,
        max: live?.meta.max ?? spec.max,
        ...(subGroup ? { subGroup } : {}),
      });
    }
  }
}

/** The header text for an automation lane bound to `paramId`. Includes the
 *  strip (drum voice / sampler pad) when the target has a sub-group, so a
 *  created lane shows WHICH strip it edits — not just "Drums · TUNE". Falls
 *  back to the raw id, flagged, when the session no longer declares the param. */
export function automationTargetLabel(target: AutomationTarget | undefined, paramId: string): string {
  if (!target) return `${paramId} (unavailable)`;
  const head = target.subGroup ? `${target.laneName} · ${target.subGroup.label}` : target.laneName;
  return `${head} · ${target.label}`;
}

/** Group targets by lane for a picker's <optgroup>s, in session lane order. */
export function groupTargetsByLane(targets: AutomationTarget[]): Map<string, AutomationTarget[]> {
  const groups = new Map<string, AutomationTarget[]>();
  for (const t of targets) {
    const key = t.subGroup ? `${t.laneName} · ${t.subGroup.label}` : t.laneName;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(t);
  }
  return groups;
}
