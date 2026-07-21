// src/engines/sampler-subgroups.ts
// Presentation + dynamic-catalogue support for the Sampler's per-pad params.
//
// The Sampler's per-pad params (`zone<note>.tune`, …) are NOT in the static
// param spec — they depend on the lane's keymap, which lives in the session
// (`lane.engineState.sampler.keymap`). listAutomationTargets calls
// samplerDynamicParamsFor to fold them into the destination catalogue, and
// samplerSubGroupFor names each pad by its note for the dropdown heading.
//
// The label is the NOTE, deliberately: the sample's *name* is not in the session
// (only an opaque sampleId + the note), so naming a pad by its sample would
// reintroduce the load-order staleness the destination registry exists to kill.
import type { EngineParamSpec } from './engine-params';
import type { SessionLane } from '../session/session';
import { PAD_LEAF_SPECS, padKeyForNote, noteForPadKey } from './sampler-pad-params';
import { noteName } from './note-name';

export function samplerDynamicParamsFor(lane: SessionLane): EngineParamSpec[] {
  const keymap = lane.engineState?.sampler?.keymap ?? [];
  const out: EngineParamSpec[] = [];
  for (const entry of keymap) {
    const key = padKeyForNote(entry.rootNote);
    for (const s of PAD_LEAF_SPECS) {
      const { leaf, ...rest } = s;
      out.push({ ...rest, id: `${key}.${leaf}` });
    }
  }
  return out;
}

export function samplerSubGroupFor(paramId: string): { key: string; label: string } | undefined {
  const dot = paramId.indexOf('.');
  const seg = dot < 0 ? paramId : paramId.slice(0, dot);
  // Round-trip through the pad-key format's owner (padKeyForNote/noteForPadKey)
  // rather than re-encoding `zone<note>` as a local regex: only a genuine pad
  // key survives padKeyForNote(noteForPadKey(seg)) === seg, so the format has a
  // single source of truth. `gain`/`poly` → NaN → mismatch → undefined; a bare
  // `zone` (no digits) → 0 → `zone0` ≠ `zone` → undefined.
  const note = noteForPadKey(seg);
  if (!Number.isInteger(note) || padKeyForNote(note) !== seg) return undefined;
  return { key: seg, label: noteName(note) };
}
