import { listEngines } from '../engines/registry';
import type { ParsedMidi } from './midi-parse';

export interface GMMatch {
  engineId: string;
  presetName: string;
}

export function findGMMatches(program: number): GMMatch[] {
  const out: GMMatch[] = [];
  for (const eng of listEngines()) {
    for (const p of eng.presets ?? []) {
      if ((p.gm ?? []).includes(program)) out.push({ engineId: eng.id, presetName: p.name });
    }
  }
  return out;
}

export function firstMatchForGM(program: number): GMMatch {
  const matches = findGMMatches(program);
  return matches[0] ?? { engineId: 'poly', presetName: 'Init' };
}

export function pickPresetForGM(program: number, rng: () => number): GMMatch {
  const matches = findGMMatches(program);
  if (matches.length === 0) return { engineId: 'poly', presetName: 'Init' };
  return matches[Math.floor(rng() * matches.length)];
}

const DRUM_ENGINE_IDS = ['drums', 'drums-machine']; // accept either name

function isDrumsEngine(engineId: string): boolean {
  return DRUM_ENGINE_IDS.includes(engineId);
}

function drumFallback(): GMMatch {
  for (const eng of listEngines()) {
    if (isDrumsEngine(eng.id)) return { engineId: eng.id, presetName: 'KIT Standard' };
  }
  return { engineId: 'drums-machine', presetName: 'KIT Standard' };
}

export function firstDrumKitForGM(program: number): GMMatch {
  const matches = findGMMatches(program).filter((m) => isDrumsEngine(m.engineId));
  return matches[0] ?? drumFallback();
}

export function pickDrumKitForGM(program: number, rng: () => number): GMMatch {
  const matches = findGMMatches(program).filter((m) => isDrumsEngine(m.engineId));
  if (matches.length === 0) return drumFallback();
  return matches[Math.floor(rng() * matches.length)];
}

export function suggestDefaultMapping(
  parsed: ParsedMidi,
  selectedTrackIndices: number[],
): { presetPerTrack: Record<number, GMMatch>; drumKitMatch: GMMatch | null } {
  const presetPerTrack: Record<number, GMMatch> = {};
  let drumKitMatch: GMMatch | null = null;
  for (const idx of selectedTrackIndices) {
    const tr = parsed.tracks.find((t) => t.index === idx);
    if (!tr) continue;
    const isDrum = tr.notes.some((n) => n.channel === 9);
    if (isDrum) {
      if (drumKitMatch === null) {
        drumKitMatch = tr.program >= 0 ? firstDrumKitForGM(tr.program) : drumFallback();
      }
    } else {
      const prog = tr.program < 0 ? 0 : tr.program;
      presetPerTrack[idx] = firstMatchForGM(prog);
    }
  }
  return { presetPerTrack, drumKitMatch };
}
