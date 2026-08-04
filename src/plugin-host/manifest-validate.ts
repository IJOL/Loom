// Validates a plugin.json that came from OUTSIDE. Runs before a single line of
// plugin code is evaluated, so a malformed or incompatible plugin fails as data
// rather than as a mid-boot exception.
import { LOOM_API_VERSION, type PluginManifestFile, type EngineParamSpec } from '@loom/plugin-sdk';

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
  if (p.group !== undefined && !isStr(p.group)) return `params[${i}].group must be a string when present`;
  return null;
}

/** `groups` is optional — a manifest that omits it gets the pre-groups
 *  fallback (see manifest.ts) — but a DECLARED entry must have the same shape
 *  a built-in engine's table has, checked exactly like `params` above. */
function groupsError(c: unknown, i: number): string | null {
  if (!isObj(c) || c.groups === undefined) return null;
  if (!Array.isArray(c.groups)) return `components[${i}].groups must be an array`;
  for (let j = 0; j < c.groups.length; j++) {
    const g = c.groups[j];
    if (!isObj(g)) return `components[${i}].groups[${j}] is not an object`;
    if (!isStr(g.id)) return `components[${i}].groups[${j}].id must be a non-empty string`;
    if (!isStr(g.title)) return `components[${i}].groups[${j}].title must be a non-empty string`;
    if (g.row !== undefined && !isNum(g.row)) return `components[${i}].groups[${j}].row must be a number when present`;
    if (g.color !== undefined && !isStr(g.color)) return `components[${i}].groups[${j}].color must be a string when present`;
  }
  return null;
}

const ASSET_KINDS = ['audio-file'];
const CLIP_CONTENTS = ['notes', 'audio'];
const NOTE_VIEWS = ['pitches', 'pads'];

function capabilitiesError(c: unknown, i: number): string | null {
  if (!isObj(c)) return `components[${i}].capabilities is not an object`;
  if (c.clipContent !== 'notes' && c.clipContent !== 'audio') {
    return `components[${i}].capabilities.clipContent must be ${CLIP_CONTENTS.join('|')}`;
  }
  if (c.defaultNoteView !== undefined
      && c.defaultNoteView !== 'pitches' && c.defaultNoteView !== 'pads') {
    return `components[${i}].capabilities.defaultNoteView must be ${NOTE_VIEWS.join('|')}`;
  }
  if (!isStr(c.shortLabel)) return `components[${i}].capabilities.shortLabel must be a non-empty string`;
  // No default: a missing trim is a plugin that never thought about gain
  // staging, and guessing 1 would ship it louder than everything else.
  if (!isNum(c.outputTrim)) return `components[${i}].capabilities.outputTrim must be a number`;
  if (c.accepts !== undefined) {
    if (!Array.isArray(c.accepts) || c.accepts.some((a) => !ASSET_KINDS.includes(a as string))) {
      return `components[${i}].capabilities.accepts must be an array of ${ASSET_KINDS.join('|')}`;
    }
  }
  for (const k of ['acceptsNoteFx', 'harmonic', 'isRandomizable'] as const) {
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

const DRIVERS = ['time', 'gate'];
const SCOPES = ['shared', 'per-voice'];

function modulatorDeclarationError(m: unknown, i: number): string | null {
  if (!isObj(m)) return `components[${i}].modulator is not an object`;
  if (m.driver !== 'time' && m.driver !== 'gate') {
    return `components[${i}].modulator.driver must be ${DRIVERS.join('|')}`;
  }
  if (!Array.isArray(m.scopes) || m.scopes.length === 0
      || m.scopes.some((s) => !SCOPES.includes(s as string))) {
    return `components[${i}].modulator.scopes must be a non-empty array of ${SCOPES.join('|')}`;
  }
  if (!isStr(m.idPrefix)) return `components[${i}].modulator.idPrefix must be a non-empty string`;
  return null;
}

function fxDeclarationError(f: unknown, i: number): string | null {
  if (!isObj(f)) return `components[${i}] needs an fx object`;
  if (!isStr(f.color)) return `components[${i}].fx.color must be a non-empty string`;
  return null;
}

function componentError(c: unknown, i: number): string | null {
  if (!isObj(c)) return `components[${i}] is not an object`;
  if (c.kind !== 'engine' && c.kind !== 'modulator' && c.kind !== 'fx') {
    return `components[${i}].kind must be engine|modulator|fx`;
  }
  if (!isStr(c.id)) return `components[${i}].id must be a non-empty string`;
  if (!isStr(c.name)) return `components[${i}].name must be a non-empty string`;
  if (!Array.isArray(c.params)) return `components[${i}].params must be an array`;
  for (let j = 0; j < c.params.length; j++) {
    const err = paramError(c.params[j], j);
    if (err) return `components[${i}].${err}`;
  }
  // A modulator component declares neither polyphony nor an editor layout, so
  // it returns before either is checked.
  if (c.kind === 'modulator') return modulatorDeclarationError(c.modulator, i);
  // An fx declares no polyphony, no capabilities and no editor layout: it has no
  // lane of its own. Its params render in the rack, which has no sections.
  if (c.kind === 'fx') return fxDeclarationError(c.fx, i);
  if (c.polyphony !== 'mono' && c.polyphony !== 'poly') return `components[${i}].polyphony must be mono|poly`;
  const gErr = groupsError(c, i);
  if (gErr) return gErr;
  return capabilitiesError(c.capabilities, i);
}

export function validatePluginManifest(raw: unknown): ValidationResult {
  if (!isObj(raw)) return { ok: false, error: 'manifest is not an object' };
  for (const k of ['id', 'name', 'version'] as const) {
    if (!isStr(raw[k])) return { ok: false, error: `${k} must be a non-empty string` };
  }
  if (raw.loomApi !== LOOM_API_VERSION) {
    return { ok: false, error: `loomApi ${String(raw.loomApi)} is not supported (host speaks ${LOOM_API_VERSION})` };
  }
  for (const k of ['main', 'dsp', 'presets'] as const) {
    if (raw[k] !== undefined && !isStr(raw[k])) return { ok: false, error: `${k} must be a string when present` };
  }
  if (raw.private !== undefined && typeof raw.private !== 'boolean') {
    return { ok: false, error: 'private must be a boolean when present' };
  }
  if (!Array.isArray(raw.components)) return { ok: false, error: 'components must be an array' };
  for (let i = 0; i < raw.components.length; i++) {
    const err = componentError(raw.components[i], i);
    if (err) return { ok: false, error: err };
  }
  return { ok: true, manifest: raw as unknown as PluginManifestFile };
}

export type { EngineParamSpec };
