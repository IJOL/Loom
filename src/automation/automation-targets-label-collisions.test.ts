// @vitest-environment jsdom
//
// Two params of one engine may share a display label — the Subtractive has a
// cutoff in FILTER A and another in FILTER B, both labelled "Cutoff" — and the
// automation pickers used to show them as two identical rows told apart only by
// position. The catalogue now prefixes a COLLIDING label with its group's
// title; unique labels stay as they are, because "OSC 1 · Waveform" where
// "Waveform" already says it is noise, not information.
import { describe, it, expect } from 'vitest';
import { listAutomationTargets } from './automation-targets';
import { emptySessionState, type SessionState } from '../session/session';
import { registerPluginEngine } from '../../test/plugin-fixtures';
import type { KnobHandle } from '../core/knob';
// Registered for the rack tests below: LAYERS declares its slot params
// dynamically from whatever engine each slot holds.
import '../engines/layers-engine';
import '../engines/drums-engine';

registerPluginEngine('subtractive');

function stateWith(lane: unknown): SessionState {
  return { ...emptySessionState(), lanes: [lane] } as SessionState;
}

const LANE = { id: 'P', name: 'Sub', engineId: 'subtractive', clips: [], inserts: [] };

describe('listAutomationTargets — same-label params of one engine', () => {
  it('prefixes both colliding cutoffs with their group title', () => {
    const targets = listAutomationTargets(stateWith(LANE), new Map());
    expect(targets.find((t) => t.id === 'P.filter.cutoff')?.label).toBe('FILTER A · Cutoff');
    expect(targets.find((t) => t.id === 'P.filter2.cutoff')?.label).toBe('FILTER B · Cutoff');
  });

  it('the two resonances collide too — the manifest labels them alike on purpose', () => {
    // "Res" in FILTER B was just as ambiguous as a literal collision without
    // triggering the disambiguation; the manifest now says "Resonance" twice so
    // both come out prefixed.
    const targets = listAutomationTargets(stateWith(LANE), new Map());
    expect(targets.find((t) => t.id === 'P.filter.resonance')?.label).toBe('FILTER A · Resonance');
    expect(targets.find((t) => t.id === 'P.filter2.resonance')?.label).toBe('FILTER B · Resonance');
  });

  it('leaves a unique label alone', () => {
    const targets = listAutomationTargets(stateWith(LANE), new Map());
    expect(targets.find((t) => t.id === 'P.filter.blend')?.label).toBe('Blend');
  });

  it('a LAYERS rack tells its slots apart AND its filters apart', () => {
    // The worst incarnation of the report: two Subtractive slots in one rack
    // put EIGHT identical Cutoff/Resonance rows in a picker. The slot is a
    // sub-group ("Layer 1"/"Layer 2"); within one slot the two filters still
    // collide, so the group-title prefix applies per sub-group, off the
    // DYNAMIC group table the rack derives from its slot engines.
    const targets = listAutomationTargets(stateWith({
      id: 'R', name: 'Rack', engineId: 'layers', clips: [], inserts: [],
      engineState: { layers: [{ engineId: 'subtractive' }, { engineId: 'subtractive' }] },
    }), new Map());
    const l0 = targets.find((t) => t.id === 'R.l0.filter.cutoff');
    expect(l0?.subGroup).toEqual({ key: 'l0', label: 'Layer 1' });
    expect(l0?.label).toBe('FILTER A · Cutoff');
    const l1 = targets.find((t) => t.id === 'R.l1.filter2.cutoff');
    expect(l1?.subGroup).toEqual({ key: 'l1', label: 'Layer 2' });
    expect(l1?.label).toBe('FILTER B · Cutoff');
  });

  it('does not count collisions across sub-groups', () => {
    // Every drum voice has a Tune; each sits under its own voice heading, so
    // none of them needs a prefix — a census run across the whole engine would
    // have prefixed all eight.
    const targets = listAutomationTargets(stateWith({
      id: 'D', name: 'Drums', engineId: 'drums-machine', clips: [], inserts: [],
    }), new Map());
    const kick = targets.find((t) => t.id === 'D.kick.tune');
    expect(kick?.subGroup?.label).toBe('Kick');
    expect(kick?.label).not.toContain('·');
  });

  it('a mounted knob cannot re-introduce the ambiguity', () => {
    // The live knob's label normally wins (it is what the user sees on screen),
    // but it carries the bare "Cutoff" — the prefix goes on top of it.
    const live = new Map<string, KnobHandle>([
      ['P.filter.cutoff', { meta: { id: 'P.filter.cutoff', label: 'Cutoff', min: 0, max: 1 } } as KnobHandle],
    ]);
    const targets = listAutomationTargets(stateWith(LANE), live);
    expect(targets.find((t) => t.id === 'P.filter.cutoff')?.label).toBe('FILTER A · Cutoff');
  });
});
