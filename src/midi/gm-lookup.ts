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

// Every selected track — drum-channel or not — gets a per-track preset from the
// same GM lookup. Channel 9 is not special-cased: a drum track whose program is
// a GM kit simply matches a drums-machine preset through the ordinary path.
export function suggestDefaultMapping(
  parsed: ParsedMidi,
  selectedTrackIndices: number[],
): { presetPerTrack: Record<number, GMMatch> } {
  const presetPerTrack: Record<number, GMMatch> = {};
  for (const idx of selectedTrackIndices) {
    const tr = parsed.tracks.find((t) => t.index === idx);
    if (!tr) continue;
    const prog = tr.program < 0 ? 0 : tr.program;
    presetPerTrack[idx] = firstMatchForGM(prog);
  }
  return { presetPerTrack };
}
