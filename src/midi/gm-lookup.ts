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

// Track-name → engine-family hints. GM program numbers in real MIDI files are
// frequently wrong or junk (a track NAMED "Guitar" carrying a non-guitar
// program, a track NAMED "Drums" on a melodic program), so the human-written
// track name is often the better signal. First keyword hit wins, so order
// matters: more specific instrument families come first. Lower-cased substring
// match — "GTR lead" still hits 'gtr'.
const NAME_ENGINE_HINTS: { kw: string[]; engineId: string }[] = [
  { kw: ['guitar', 'gtr', 'pluck', 'nylon'],                                  engineId: 'karplus' },
  { kw: ['drum', 'kick', 'snare', 'hat', 'perc', 'cymbal', 'clap', 'tom', 'kit'], engineId: 'drums-machine' },
  { kw: ['rhodes', 'wurli', 'wurlitzer', 'tine', 'epiano', 'e.piano', 'e piano'], engineId: 'fm' },
  { kw: ['bell', 'glock', 'chime', 'mallet', 'vibe', 'marimba', 'kalimba'],   engineId: 'fm' },
  { kw: ['pad', 'string', 'choir', 'voice', 'vox', 'brass', 'horn', 'orch', 'ensemble'], engineId: 'subtractive' },
  { kw: ['piano', 'keys', 'organ', 'clav', 'harpsi'],                          engineId: 'subtractive' },
  { kw: ['bass'],                                                              engineId: 'subtractive' },
  { kw: ['lead', 'synth', 'saw', 'square', 'arp', 'seq', 'poly'],              engineId: 'subtractive' },
];

/** Best-effort engine family inferred from a track's NAME alone, or null when
 *  the name carries no recognizable instrument keyword. */
export function engineHintFromName(name: string | undefined): string | null {
  const n = (name ?? '').toLowerCase();
  if (!n) return null;
  for (const h of NAME_ENGINE_HINTS) {
    if (h.kw.some((k) => n.includes(k))) return h.engineId;
  }
  return null;
}

function nameTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

/** Pick a preset WITHIN a chosen engine: prefer one tagged with the GM program,
 *  else one whose name shares a word with the track name, else the first. */
function presetForEngine(engineId: string, program: number, trackName: string): GMMatch {
  const eng = listEngines().find((e) => e.id === engineId);
  const presets = eng?.presets ?? [];
  if (presets.length === 0) return { engineId, presetName: 'Init' };
  const gmHit = presets.find((p) => (p.gm ?? []).includes(program));
  if (gmHit) return { engineId, presetName: gmHit.name };
  const toks = nameTokens(trackName);
  let best = presets[0];
  let bestScore = 0;
  for (const p of presets) {
    const score = nameTokens(p.name).filter((t) => toks.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return { engineId, presetName: best.name };
}

// Every selected track — drum-channel or not — gets a per-track preset. The
// track NAME picks the engine family when it carries an instrument keyword
// (the GM program then selects the preset within that engine); otherwise we
// fall back to the pure GM-program lookup across all engines. Channel 9 is not
// special-cased.
export function suggestDefaultMapping(
  parsed: ParsedMidi,
  selectedTrackIndices: number[],
): { presetPerTrack: Record<number, GMMatch> } {
  const presetPerTrack: Record<number, GMMatch> = {};
  for (const idx of selectedTrackIndices) {
    const tr = parsed.tracks.find((t) => t.index === idx);
    if (!tr) continue;
    const prog = tr.program < 0 ? 0 : tr.program;
    const hint = engineHintFromName(tr.name);
    presetPerTrack[idx] = hint ? presetForEngine(hint, prog, tr.name) : firstMatchForGM(prog);
  }
  return { presetPerTrack };
}
