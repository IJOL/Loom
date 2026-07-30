// Validates a plugin.json that came from OUTSIDE. Runs before a single line of
// plugin code is evaluated, so a malformed or incompatible plugin fails as data
// rather than as a mid-boot exception.
import { LOOM_API_VERSION, type PluginManifestFile, type EngineManifest, type EngineParamSpec } from '@loom/plugin-sdk';

export type ValidationResult =
  | { ok: true; manifest: PluginManifestFile }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function paramError(p: unknown, i: number): string | null {
  if (!isObj(p)) return `params[${i}] is not an object`;
  if (!isStr(p.id)) return `params[${i}].id must be a non-empty string`;
  if (!isStr(p.label)) return `params[${i}].label must be a non-empty string`;
  if (p.kind !== 'continuous' && p.kind !== 'discrete') return `params[${i}].kind must be continuous|discrete`;
  for (const k of ['min', 'max', 'default'] as const) {
    if (!isNum(p[k])) return `params[${i}].${k} must be a number`;
  }
  return null;
}

function engineError(e: unknown, i: number): string | null {
  if (!isObj(e)) return `engines[${i}] is not an object`;
  if (!isStr(e.id)) return `engines[${i}].id must be a non-empty string`;
  if (!isStr(e.name)) return `engines[${i}].name must be a non-empty string`;
  if (e.polyphony !== 'mono' && e.polyphony !== 'poly') return `engines[${i}].polyphony must be mono|poly`;
  if (e.clipEditor !== 'piano-roll' && e.clipEditor !== 'drum-grid' && e.clipEditor !== 'audio') {
    return `engines[${i}].clipEditor must be piano-roll|drum-grid|audio`;
  }
  // No default: a missing trim is a plugin that never thought about gain
  // staging, and guessing 1 would ship it louder than everything else.
  if (!isNum(e.outputTrim)) return `engines[${i}].outputTrim must be a number`;
  if (!isStr(e.shortLabel)) return `engines[${i}].shortLabel must be a non-empty string`;
  if (!Array.isArray(e.params)) return `engines[${i}].params must be an array`;
  for (let j = 0; j < e.params.length; j++) {
    const err = paramError(e.params[j], j);
    if (err) return `engines[${i}].${err}`;
  }
  if (e.gm !== undefined) {
    if (!isObj(e.gm) || !Array.isArray(e.gm.keywords) || !isNum(e.gm.priority)) {
      return `engines[${i}].gm must be { keywords: string[], priority: number }`;
    }
  }
  return null;
}

export function validatePluginManifest(raw: unknown): ValidationResult {
  if (!isObj(raw)) return { ok: false, error: 'manifest is not an object' };
  for (const k of ['id', 'name', 'version', 'main'] as const) {
    if (!isStr(raw[k])) return { ok: false, error: `${k} must be a non-empty string` };
  }
  if (raw.loomApi !== LOOM_API_VERSION) {
    return { ok: false, error: `loomApi ${String(raw.loomApi)} is not supported (host speaks ${LOOM_API_VERSION})` };
  }
  for (const k of ['dsp', 'presets'] as const) {
    if (raw[k] !== undefined && !isStr(raw[k])) return { ok: false, error: `${k} must be a string when present` };
  }
  if (raw.engines !== undefined) {
    if (!Array.isArray(raw.engines)) return { ok: false, error: 'engines must be an array' };
    for (let i = 0; i < raw.engines.length; i++) {
      const err = engineError(raw.engines[i], i);
      if (err) return { ok: false, error: err };
    }
  }
  return { ok: true, manifest: raw as unknown as PluginManifestFile };
}

/** Narrowed accessor used by the capability readers. */
export function enginesOf(m: PluginManifestFile): EngineManifest[] { return m.engines ?? []; }
export type { EngineManifest, EngineParamSpec };
