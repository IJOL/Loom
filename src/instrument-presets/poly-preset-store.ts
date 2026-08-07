// Subtractive/poly preset DATA + storage: flat↔nested param conversion, the
// factory preset view over the JSON cache, and user-preset localStorage I/O.
// Split out of polysynth-presets.ts (which keeps the preset-select UI wiring).
// Pure/storage only — no DOM.

import { POLY_DEFAULTS, type PolySynthParams } from './poly-params';
import { getCachedPresets } from '../presets/preset-loader';

/** Convert a flat dot-path subtractive preset (e.g. `"osc1.wave": 0`,
 *  `"filter.cutoff": 0.55`) back into the nested PolySynthParams tree the
 *  polysynth UI still operates on. Wave indices are mapped back to their
 *  OscillatorType string. Fields not present in the flat preset keep their
 *  POLY_DEFAULTS value (so e.g. `osc1.octave` survives). */
export function flatToPolyParams(flat: Record<string, number>): PolySynthParams {
  const out = JSON.parse(JSON.stringify(POLY_DEFAULTS)) as PolySynthParams;
  const WAVE_VALUES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let cur: Record<string, unknown> = out as unknown as Record<string, unknown>;
    let bail = false;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cur[parts[i]];
      if (!next || typeof next !== 'object') { bail = true; break; }
      cur = next as Record<string, unknown>;
    }
    if (bail) continue;
    const leaf = parts[parts.length - 1];
    if (leaf === 'wave' && typeof v === 'number') {
      const idx = Math.max(0, Math.min(WAVE_VALUES.length - 1, Math.round(v)));
      cur[leaf] = WAVE_VALUES[idx];
    } else {
      cur[leaf] = v;
    }
  }
  return out;
}

/** Inverse of flatToPolyParams: flatten a nested PolySynthParams tree back to the
 *  dot-id vocabulary the SUB_PARAM_SPECS / WorkletLaneEngine consume (osc waves as
 *  0..3 indices). Used to apply a USER preset (stored as PolySynthParams) to the
 *  worklet subtractive engine, and to snapshot the engine's params on Save.
 *  Only the fields the subtractive engine reads are emitted. */
export function polyParamsToFlat(p: PolySynthParams): Record<string, number> {
  const WAVE_VALUES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
  const waveIdx = (w: OscillatorType): number => {
    const i = WAVE_VALUES.indexOf(w);
    return i < 0 ? 0 : i;
  };
  return {
    'master.tune': p.master.tune,
    'osc1.wave': waveIdx(p.osc1.wave), 'osc1.level': p.osc1.level, 'osc1.detune': p.osc1.detune,
    'osc2.wave': waveIdx(p.osc2.wave), 'osc2.level': p.osc2.level, 'osc2.detune': p.osc2.detune,
    'sub.level': p.sub.level,
    'noise.level': p.noise.level, 'noise.color': p.noise.color,
    'filter.cutoff': p.filter.cutoff, 'filter.resonance': p.filter.resonance,
    'filter.envAmount': p.filter.envAmount, 'filter.drive': p.filter.drive,
    'filter.keyTrack': p.filter.keyTrack,
    'filter.attack': p.filter.attack, 'filter.decay': p.filter.decay,
    'filter.sustain': p.filter.sustain, 'filter.release': p.filter.release,
    'amp.attack': p.amp.attack, 'amp.decay': p.amp.decay,
    'amp.sustain': p.amp.sustain, 'amp.release': p.amp.release,
  };
}

/** Typed view over the JSON-loaded subtractive preset cache, materialised as
 *  the nested `PolySynthParams` shape the polysynth UI consumes. Subtractive
 *  presets are stored flat (dot-path id → value); we expand them on the fly. */
export function getFactoryPolyPresets(): { name: string; params: PolySynthParams }[] {
  const flat = getCachedPresets('subtractive');
  return flat.map((p) => ({
    name: p.name,
    params: flatToPolyParams(p.params as unknown as Record<string, number>),
  }));
}

// `loadUserPolyPresets` / `saveUserPolyPresets` and their `tb303-poly-presets-v1`
// key lived here: user presets, subtractive-shaped, for every engine. They are
// gone with the store that replaced them (user-preset-store.ts), which files a
// preset under the engine it belongs to. Nothing was migrated because there was
// nothing to migrate — no build that wrote that key was ever released.
