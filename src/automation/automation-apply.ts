// Applying an automation value to a target that has no knob on screen.
//
// The knob handle is the convenient path — it moves the UI and the audio at
// once — but it only exists while the panel is mounted. Automation belongs to
// the session, so when no handle is available we resolve the id down to the
// live audio object and write the base value directly.
//
// This is the REPLAY path: it writes the audio object and nothing else, because
// a curve belongs to the clip or the take and must never become the lane's saved
// base sound (see automation-knob.ts). A LIVE gesture on an unmounted target has
// the opposite obligation and goes through live-control-apply.ts, which wraps
// this one — do not add persistence here.

import { WEAVE_SCOPE } from '../weave/weave-catalog';

/** A param id decomposed into what it addresses. `scopeId` is a lane id for
 *  engine params and lane racks, `fx.master` / `fx.send.<id>` for the global
 *  racks, or `session.weave` for a macro that belongs to no lane at all. */
export type ParsedParamId =
  | { scopeId: string; kind: 'engine'; paramId: string }
  | { scopeId: string; kind: 'insert'; slotId: string; paramId: string }
  | { scopeId: string; kind: 'macro'; paramId: string }
  | { scopeId: string; kind: 'modDepth'; modId: string; connId: string };

/** Split a canonical destination id. The insert marker is the first segment
 *  shaped `fx:<slotId>`; everything before it is the scope (which is itself
 *  dotted for the global racks: `fx.send.A`). */
export function parseAutomationParamId(id: string): ParsedParamId | null {
  // Matched FIRST, and by an exact marker. Everything this function does not
  // recognise falls through to "engine param of a lane" at the bottom, so a
  // session-scope destination without a marker would be read as a lane that
  // does not exist: it would land nowhere and throw nothing. Inert looks
  // exactly like working, which is the worst failure available here.
  if (id.startsWith(`${WEAVE_SCOPE}:`)) {
    const paramId = id.slice(WEAVE_SCOPE.length + 1);
    if (paramId.length > 0) return { scopeId: WEAVE_SCOPE, kind: 'macro', paramId };
  }

  // `<lane>.mod.<modId>.conn.<connId>.depth` — matched on its two literal
  // markers rather than by counting dots, so a lane id with dots in it still
  // parses and an engine param that merely starts with `mod.` still does not.
  const mod = /^(.+)\.mod\.([^.]+)\.conn\.([^.]+)\.depth$/.exec(id);
  if (mod) return { scopeId: mod[1], kind: 'modDepth', modId: mod[2], connId: mod[3] };

  const parts = id.split('.');
  if (parts.length < 2) return null;

  const slotAt = parts.findIndex((p, i) => i > 0 && p.startsWith('fx:'));
  if (slotAt > 0 && slotAt < parts.length - 1) {
    return {
      scopeId: parts.slice(0, slotAt).join('.'),
      kind: 'insert',
      slotId: parts[slotAt].slice(3),
      paramId: parts.slice(slotAt + 1).join('.'),
    };
  }
  return { scopeId: parts[0], kind: 'engine', paramId: parts.slice(1).join('.') };
}

/** The minimal audio-side surface an automation value needs to land. */
interface ParamTarget {
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
}

/** What a `modDepth` write needs of the engine it lands on: the modulation
 *  state, and the one call that makes an edit to it audible.
 *
 *  Both halves matter. `setConnection` alone changes a number the worklet has
 *  already been handed a copy of, so the sound would keep modulating at the old
 *  depth — inert looking exactly like working, which is this file's own stated
 *  worst failure. `onModulationEdited` is the same hook the modulation panel's
 *  own depth knob fires, so an automation lane and a hand on that knob take the
 *  identical path. */
interface ModDepthTarget {
  modulators?: {
    modulators: { id: string; connections: { id: string }[] }[];
    setConnection(modId: string, conn: unknown): void;
  };
  onModulationEdited?(laneId: string): void;
}

export interface AutomationApplyDeps {
  getInsertFx(scopeId: string, slotId: string): ParamTarget | undefined;
  getEngine(laneId: string): ParamTarget | undefined;
  /** Declared range for the id, so a 0..1 envelope maps to real units. */
  getRange(id: string): { min: number; max: number } | undefined;
}

/** Write `normalised` (0..1) onto the param `id` addresses. Returns false when
 *  the target is gone — the caller can then leave the envelope inert rather
 *  than guess. */
export function applyAutomationToSession(
  id: string,
  normalised: number,
  deps: AutomationApplyDeps,
): boolean {
  const parsed = parseAutomationParamId(id);
  if (!parsed) return false;

  if (parsed.kind === 'modDepth') {
    const engine = deps.getEngine(parsed.scopeId) as unknown as ModDepthTarget | undefined;
    const host = engine?.modulators;
    const range = deps.getRange(id);
    if (!host || !range) return false;
    // Resolved by id, never by position: a connection removed while a curve was
    // running would otherwise silently rewrite whichever routing slid into its
    // place. Gone means gone, and false says so.
    const mod = host.modulators.find((m) => m.id === parsed.modId);
    const conn = mod?.connections.find((c) => c.id === parsed.connId);
    if (!conn) return false;
    host.setConnection(parsed.modId, {
      ...conn, depth: range.min + normalised * (range.max - range.min),
    });
    engine?.onModulationEdited?.(parsed.scopeId);
    return true;
  }

  const target = parsed.kind === 'insert'
    ? deps.getInsertFx(parsed.scopeId, parsed.slotId)
    : deps.getEngine(parsed.scopeId);
  if (!target) return false;

  const range = deps.getRange(id);
  if (!range) return false;

  target.setBaseValue(parsed.paramId, range.min + normalised * (range.max - range.min));
  return true;
}
