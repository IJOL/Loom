import { describe, it, expect } from 'vitest';
import { resolveParamRows, type EngineParamGroup } from './engine-param-groups';
import type { EngineParamSpec } from './engine-params';

const p = (id: string, group?: string, extra: Partial<EngineParamSpec> = {}): EngineParamSpec =>
  ({ id, label: id, kind: 'continuous', min: 0, max: 1, default: 0, group, ...extra });

describe('resolveParamRows', () => {
  it('orders sections by the declared array, not by param order', () => {
    const groups: EngineParamGroup[] = [{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }];
    const rows = resolveParamRows([p('x', 'a'), p('y', 'b')], groups);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([['B'], ['A']]);
  });

  it('puts groups that share a row index into one row', () => {
    const groups: EngineParamGroup[] = [
      { id: 'osc1', title: 'OSC 1', row: 0 },
      { id: 'osc2', title: 'OSC 2', row: 0 },
      { id: 'filter', title: 'FILTER', row: 1 },
    ];
    const rows = resolveParamRows([p('a', 'osc1'), p('b', 'osc2'), p('c', 'filter')], groups);
    expect(rows).toHaveLength(2);
    expect(rows[0].sections.map((s) => s.title)).toEqual(['OSC 1', 'OSC 2']);
    expect(rows[1].sections.map((s) => s.title)).toEqual(['FILTER']);
  });

  it('carries the group colour onto its section', () => {
    const rows = resolveParamRows([p('a', 'osc1')], [{ id: 'osc1', title: 'OSC 1', color: '#2ee0c0' }]);
    expect(rows[0].sections[0].color).toBe('#2ee0c0');
  });

  it('falls back to today behaviour when a group is not declared', () => {
    const rows = resolveParamRows([p('a'), p('b', 'OP1'), p('c', 'OP2')]);
    expect(rows[0].sections[0].title).toBeUndefined();     // leading ungrouped row
    expect(rows[1].sections[0].title).toBe('OP1');          // the string IS the title
    expect(rows[2].sections[0].title).toBe('OP2');
  });

  it('omits a param drawn by another surface, and the section it empties', () => {
    const groups: EngineParamGroup[] = [{ id: 'amp', title: 'AMP' }, { id: 'osc1', title: 'OSC 1' }];
    const rows = resolveParamRows(
      [p('amp.attack', 'amp', { drawnBy: 'modulators' }), p('osc1.level', 'osc1')], groups);
    expect(rows.flatMap((r) => r.sections.map((s) => s.title))).toEqual(['OSC 1']);
  });

  it('declared-but-absent groups produce no empty row', () => {
    const rows = resolveParamRows([p('a', 'osc1')], [{ id: 'osc1', title: 'OSC 1' }, { id: 'ghost', title: 'GHOST' }]);
    expect(rows).toHaveLength(1);
  });

  it('two declared groups sharing a title but different row values do not merge', () => {
    const groups: EngineParamGroup[] = [
      { id: 'a', title: 'DUP', row: 0 },
      { id: 'b', title: 'DUP', row: 1 },
    ];
    const rows = resolveParamRows([p('x', 'a'), p('y', 'b')], groups);
    expect(rows).toHaveLength(2);
    expect(rows[0].sections.map((s) => s.specs[0].id)).toEqual(['x']);
    expect(rows[1].sections.map((s) => s.specs[0].id)).toEqual(['y']);
  });

  it("an undeclared group's raw string equal to a declared group's title does not join that group's row", () => {
    const groups: EngineParamGroup[] = [{ id: 'a', title: 'DUP', row: 0 }];
    const rows = resolveParamRows([p('x', 'a'), p('y', 'DUP')], groups);
    expect(rows).toHaveLength(2);
    expect(rows[0].sections.map((s) => s.specs[0].id)).toEqual(['x']);
    expect(rows[1].sections.map((s) => s.specs[0].id)).toEqual(['y']);
  });

  it('a declared group with row 0 coexisting with an undeclared group stays apart even when raw group text collides', () => {
    const groups: EngineParamGroup[] = [
      { id: 'a', title: 'ROW', row: 0 },
      { id: 'b', title: 'FILTER', row: 0 },
    ];
    const rows = resolveParamRows([p('x', 'a'), p('y', 'b'), p('z', 'ROW')], groups);
    expect(rows).toHaveLength(2);
    expect(rows[0].sections.map((s) => s.specs[0].id)).toEqual(['x', 'y']);
    expect(rows[1].sections.map((s) => s.specs[0].id)).toEqual(['z']);
  });

  // PIN, not a spec: `row` is a grouping KEY, not a position. Output order
  // follows the order a row is first ENCOUNTERED while walking the declared
  // groups array, never the numeric row value. Every current engine happens
  // to declare ascending rows (0, 1, 2, ...), which hides this — this test
  // proves it with a declared array in descending numeric order. If this
  // starts failing, `row`'s meaning changed; that is a deliberate semantics
  // change, not a bug fix, and needs its own decision.
  it('row output order follows first-encounter in the declared array, not the numeric row value', () => {
    const groups: EngineParamGroup[] = [
      { id: 'a', title: 'A', row: 2 },
      { id: 'b', title: 'B', row: 0 },
    ];
    const rows = resolveParamRows([p('x', 'a'), p('y', 'b')], groups);
    expect(rows).toHaveLength(2);
    // 'a' (row: 2) is declared first, so its row comes out first — even
    // though 'b' declares the numerically smaller row: 0.
    expect(rows[0].sections.map((s) => s.title)).toEqual(['A']);
    expect(rows[1].sections.map((s) => s.title)).toEqual(['B']);
  });
});
