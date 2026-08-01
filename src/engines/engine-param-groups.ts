// src/engines/engine-param-groups.ts
// How an engine's params become rows of labelled sections. Pure: no DOM, no lit.
//
// This is the model that replaces hand-written markup. Before it, the ONLY way
// to say "OSC 1 │ OSC 2 │ SUB │ NOISE share one line, in that order, each in its
// own colour" was to write that line in index.html — which is why exactly one
// engine had a page of its own and three `if (engineId === 'subtractive')`
// branches existed to keep it out of everyone else's way.

import type { EngineParamSpec } from './engine-params';

export interface EngineParamGroup {
  /** Key referenced by EngineParamSpec.group. */
  id: string;
  /** Printed as the section header. Free of the id so a group can be renamed
   *  without touching every param that belongs to it. */
  title: string;
  /** Groups sharing a row index render side by side on one line, separated by a
   *  vertical divider. Default: a row of its own, in declaration order. */
  row?: number;
  /** CSS colour for this section's knob rings. A param's own `color` wins. */
  color?: string;
}

export interface ParamSection {
  /** The declared group's id, and the ONLY key row packing may use. Absent for
   *  the leading ungrouped row and for a group nobody declared. */
  id?: string;
  /** Absent for the leading row of ungrouped params, which has no header. */
  title?: string;
  color?: string;
  specs: EngineParamSpec[];
}

export interface ParamRow { sections: ParamSection[]; }

export function resolveParamRows(
  specs: EngineParamSpec[], groups?: EngineParamGroup[],
): ParamRow[] {
  const drawn = specs.filter((s) => !s.drawnBy);
  const byKey = new Map<string, EngineParamSpec[]>();
  const seen: string[] = [];
  for (const s of drawn) {
    const key = s.group ?? '';
    if (!byKey.has(key)) { byKey.set(key, []); seen.push(key); }
    byKey.get(key)!.push(s);
  }

  const declared = groups ?? [];
  const declaredIds = new Set(declared.map((g) => g.id));
  // Ungrouped first (the leading row), then declared groups in array order,
  // then any group nobody declared, in first-appearance order — which is
  // exactly what the grid did before groups were declarable at all.
  const ordered: ParamSection[] = [];
  if (byKey.has('')) ordered.push({ specs: byKey.get('')! });
  for (const g of declared) {
    const members = byKey.get(g.id);
    if (members?.length) ordered.push({ id: g.id, title: g.title, color: g.color, specs: members });
  }
  for (const key of seen) {
    if (key === '' || declaredIds.has(key)) continue;
    ordered.push({ title: key, specs: byKey.get(key)! });
  }

  // Row packing. A section whose group declares `row` joins that row; every
  // other section keeps a row to itself, so an engine that declares nothing
  // renders exactly as it does today.
  //
  // Keyed by group ID, never by title. Two declared groups may legitimately
  // share a title, and an UNDECLARED group's raw string may collide with a
  // declared group's title — keying by title silently packs unrelated sections
  // into one row. `id` is the stable key the type's own doc comment promises;
  // `ParamSection` therefore carries it, and an undeclared section has none.
  const rowOf = new Map<string, number>();
  for (const g of declared) if (g.row !== undefined) rowOf.set(g.id, g.row);
  const rows: ParamRow[] = [];
  const byRowIndex = new Map<number, ParamRow>();
  for (const section of ordered) {
    const idx = section.id !== undefined ? rowOf.get(section.id) : undefined;
    if (idx === undefined) { rows.push({ sections: [section] }); continue; }
    let row = byRowIndex.get(idx);
    if (!row) { row = { sections: [] }; byRowIndex.set(idx, row); rows.push(row); }
    row.sections.push(section);
  }
  return rows;
}
