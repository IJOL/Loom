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

const ASSET_KINDS = ['audio-file'];
const CLIP_EDITORS = ['piano-roll', 'drum-grid', 'audio'];

function capabilitiesError(c: unknown, i: number): string | null {
  if (!isObj(c)) return `components[${i}].capabilities is not an object`;
  if (typeof c.clipEditor !== 'string' || !CLIP_EDITORS.includes(c.clipEditor)) {
    return `components[${i}].capabilities.clipEditor must be ${CLIP_EDITORS.join('|')}`;
  }
  if (!isStr(c.shortLabel)) return `components[${i}].capabilities.shortLabel must be a non-empty string`;
  // Sin default: un trim ausente es un plugin que no pensó en el gain staging,
  // y adivinar 1 lo publica más alto que todo lo demás.
  if (!isNum(c.outputTrim)) return `components[${i}].capabilities.outputTrim must be a number`;
  if (c.accepts !== undefined) {
    if (!Array.isArray(c.accepts) || c.accepts.some((a) => !ASSET_KINDS.includes(a as string))) {
      return `components[${i}].capabilities.accepts must be an array of ${ASSET_KINDS.join('|')}`;
    }
  }
  for (const k of ['acceptsNoteFx', 'listedInSelector', 'harmonic'] as const) {
    if (c[k] !== undefined && typeof c[k] !== 'boolean') {
      return `components[${i}].capabilities.${k} must be a boolean when present`;
    }
  }
  if (c.gm !== undefined) {
    if (!isObj(c.gm) || !Array.isArray(c.gm.keywords) || !isNum(c.gm.priority)) {
      return `components[${i}].capabilities.gm must be { keywords: string[], priority: number }`;
    }
  }
  return null;
}

function componentError(c: unknown, i: number): string | null {
  if (!isObj(c)) return `components[${i}] is not an object`;
  if (c.kind !== 'engine') return `components[${i}].kind must be engine`;
  if (!isStr(c.id)) return `components[${i}].id must be a non-empty string`;
  if (!isStr(c.name)) return `components[${i}].name must be a non-empty string`;
  if (c.polyphony !== 'mono' && c.polyphony !== 'poly') return `components[${i}].polyphony must be mono|poly`;
  if (!Array.isArray(c.params)) return `components[${i}].params must be an array`;
  for (let j = 0; j < c.params.length; j++) {
    const err = paramError(c.params[j], j);
    if (err) return `components[${i}].${err}`;
  }
  return capabilitiesError(c.capabilities, i);
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
  if (!Array.isArray(raw.components)) return { ok: false, error: 'components must be an array' };
  for (let i = 0; i < raw.components.length; i++) {
    const err = componentError(raw.components[i], i);
    if (err) return { ok: false, error: err };
  }
  return { ok: true, manifest: raw as unknown as PluginManifestFile };
}

export type { EngineManifest, EngineParamSpec };
