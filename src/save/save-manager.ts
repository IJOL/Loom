// Save manager: named entries, autosave, downloads.
//
// Split storage, on purpose:
//   • the INDEX (id/name/timestamp/sizeKB) → localStorage. Tiny, and reading it
//     synchronously is what lets the Save Manager list render without awaiting.
//   • the PAYLOADS (the serialized session JSON) → IndexedDB, via save-store.
//
// Payloads used to live in localStorage too, and that is a ~5 MB per-origin cap
// no API or flag can raise: a handful of sessions carrying Performance
// automation curves filled it, and every save after that threw
// QuotaExceededError and was lost.

import { downloadBlob } from '../export/download';
import { putPayload, getPayload, deletePayload, listPayloadIds } from './save-store';

const INDEX_KEY = 'tb303-saves';
/** Reserved payload id. Save ids are `s-…`, so this cannot collide. */
const AUTOSAVE_ID = '__autosave__';

// Pre-IndexedDB layout, read once by migrateLegacySaves() and then erased.
const LEGACY_ENTRY_KEY = (id: string) => `tb303-save:${id}`;
const LEGACY_AUTOSAVE_KEY = 'tb303-save:autosave';
const LEGACY_PREFIX = 'tb303-save:';

export interface SaveIndexEntry {
  id: string;
  name: string;
  timestamp: number;
  sizeKB: number;
}

export function readIndex(): SaveIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeIndex(idx: SaveIndexEntry[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

function parse(json: string | null): unknown | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Writes the payload FIRST and the index row only once it landed. The old
 *  order was the reverse, so every failed write left a row in the list that
 *  loaded as null. Rejects if the payload cannot be stored — callers surface
 *  that instead of reporting a save that did not happen. */
export async function saveNamedEntry(name: string, state: unknown): Promise<SaveIndexEntry> {
  const json = JSON.stringify(state);
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  await putPayload(id, json);
  // The autosave is a full second copy rather than a pointer at the newest
  // entry, because "Clear all saves" promises to preserve it.
  await putPayload(AUTOSAVE_ID, json);

  const entry: SaveIndexEntry = { id, name, timestamp: Date.now(), sizeKB: Math.round(json.length / 1024) };
  const idx = readIndex();
  idx.push(entry);
  writeIndex(idx);
  return entry;
}

export async function loadEntry(id: string): Promise<unknown | null> {
  try {
    return parse(await getPayload(id));
  } catch {
    return null;
  }
}

export async function loadAutosave(): Promise<unknown | null> {
  try {
    return parse(await getPayload(AUTOSAVE_ID));
  } catch {
    return null;
  }
}

export async function deleteEntry(id: string): Promise<void> {
  writeIndex(readIndex().filter((e) => e.id !== id));
  await deletePayload(id);
}

export function renameEntry(id: string, name: string): void {
  const idx = readIndex();
  const e = idx.find((x) => x.id === id);
  if (e) { e.name = name; writeIndex(idx); }
}

export async function clearAll(): Promise<void> {
  const idx = readIndex();
  writeIndex([]);
  for (const e of idx) await deletePayload(e.id);
}

export function totalStorageKB(): number {
  let total = 0;
  for (const e of readIndex()) total += e.sizeKB;
  return total;
}

/** One-time move of the pre-IndexedDB layout, plus the cleanup it implies.
 *  Called at boot. Safe to run repeatedly: with nothing legacy left it only
 *  re-checks the index.
 *
 *  Three jobs:
 *   1. copy every reachable `tb303-save:*` payload into IndexedDB and free the
 *      localStorage key;
 *   2. drop index rows with no payload anywhere — the orphans the old
 *      index-before-payload order left behind on every QuotaExceededError;
 *   3. bin leftover `tb303-save:*` keys that no index row points at. Nothing can
 *      reach them through the UI and they hold the 5 MB hostage from the other
 *      localStorage users (presets, stem config, MIDI mappings). */
export async function migrateLegacySaves(): Promise<void> {
  let stored: Set<string>;
  try {
    stored = new Set(await listPayloadIds());
  } catch {
    // No IndexedDB (or it failed to open): leave everything exactly as it is.
    // Pruning the index against an unreadable store would delete live saves.
    return;
  }

  const legacyAutosave = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
  if (legacyAutosave !== null && !stored.has(AUTOSAVE_ID)) {
    await putPayload(AUTOSAVE_ID, legacyAutosave);
  }
  localStorage.removeItem(LEGACY_AUTOSAVE_KEY);

  const kept: SaveIndexEntry[] = [];
  for (const entry of readIndex()) {
    const legacy = localStorage.getItem(LEGACY_ENTRY_KEY(entry.id));
    if (legacy !== null && !stored.has(entry.id)) {
      await putPayload(entry.id, legacy);
      stored.add(entry.id);
    }
    localStorage.removeItem(LEGACY_ENTRY_KEY(entry.id));
    if (stored.has(entry.id)) kept.push(entry);
  }
  writeIndex(kept);

  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(LEGACY_PREFIX)) localStorage.removeItem(key);
  }
}

export function downloadAsJson(filename: string, state: unknown): void {
  const json = JSON.stringify(state, null, 2);
  // The anchor-click mechanics (and the deferred URL revoke) live in the one
  // shared download helper — don't grow a second anchor builder here.
  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
}

export async function loadFromFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}
