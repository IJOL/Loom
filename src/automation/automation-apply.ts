// Applying an automation value to a target that has no knob on screen.
//
// The knob handle is the convenient path — it moves the UI and the audio at
// once — but it only exists while the panel is mounted. Automation belongs to
// the session, so when no handle is available we resolve the id down to the
// live audio object and write the base value directly.

/** A param id decomposed into what it addresses. `scopeId` is a lane id for
 *  engine params and lane racks, or `fx.master` / `fx.send.<id>` for the
 *  global racks. */
export type ParsedParamId =
  | { scopeId: string; kind: 'engine'; paramId: string }
  | { scopeId: string; kind: 'insert'; slotId: string; paramId: string };

/** Split a canonical destination id. The insert marker is the first segment
 *  shaped `fx:<slotId>`; everything before it is the scope (which is itself
 *  dotted for the global racks: `fx.send.A`). Returns null if the id is shaped
 *  like the legacy positional form (`fx\d+`) because it cannot be distinguished
 *  from a valid engine param at parse time — a gap in translation would fail
 *  silently and incorrectly report "engine param not found" instead of "insert
 *  was replaced or deleted". */
export function parseAutomationParamId(id: string): ParsedParamId | null {
  // Reject legacy-shaped ids (e.g. 'L1.fx2.mix') upfront so they don't
  // misclassify as engine params.
  if (parseLegacyInsertParamId(id) !== null) return null;

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

/** Read the OLD positional insert id (`<scope>.fx2.<param>`). Used only by the
 *  load-time translation in Task 3 — nothing at runtime should produce these. */
export function parseLegacyInsertParamId(
  id: string,
): { scopeId: string; slotIdx: number; paramId: string } | null {
  const parts = id.split('.');
  const slotAt = parts.findIndex((p, i) => i > 0 && /^fx\d+$/.test(p));
  if (slotAt <= 0 || slotAt >= parts.length - 1) return null;
  return {
    scopeId: parts.slice(0, slotAt).join('.'),
    slotIdx: Number(parts[slotAt].slice(2)),
    paramId: parts.slice(slotAt + 1).join('.'),
  };
}

/** The minimal audio-side surface an automation value needs to land. */
interface ParamTarget {
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
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

  const target = parsed.kind === 'insert'
    ? deps.getInsertFx(parsed.scopeId, parsed.slotId)
    : deps.getEngine(parsed.scopeId);
  if (!target) return false;

  const range = deps.getRange(id);
  if (!range) return false;

  target.setBaseValue(parsed.paramId, range.min + normalised * (range.max - range.min));
  return true;
}
