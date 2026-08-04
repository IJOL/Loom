// @vitest-environment jsdom
// The save payloads live in IndexedDB, NOT localStorage — localStorage is capped
// at ~5 MB per origin and a handful of sessions with automation curves blew it
// (QuotaExceededError, save silently lost). Only the index (name/date/size) stays
// in localStorage: it is tiny, and keeping it there is what lets the modal list
// render synchronously.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  saveNamedEntry, loadEntry, loadAutosave, deleteEntry, renameEntry,
  clearAll, readIndex, totalStorageKB, migrateLegacySaves,
} from './save-manager';

const INDEX_KEY = 'tb303-saves';
const DB_NAME = 'tb303-saves';

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  localStorage.clear();
  await deleteDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('save payloads live in IndexedDB', () => {
  it('round-trips a saved session and keeps the payload out of localStorage', async () => {
    const state = { schemaVersion: 3, bpm: 128, blob: 'x'.repeat(5000) };
    const entry = await saveNamedEntry('Alpha', state);

    expect(await loadEntry(entry.id)).toEqual(state);
    expect(localStorage.getItem(`tb303-save:${entry.id}`)).toBeNull();
    expect(readIndex().map((e) => e.name)).toEqual(['Alpha']);
    expect(totalStorageKB()).toBe(entry.sizeKB);
  });

  it('serves the last save as the autosave', async () => {
    await saveNamedEntry('First', { bpm: 100 });
    await saveNamedEntry('Second', { bpm: 140 });

    expect(await loadAutosave()).toEqual({ bpm: 140 });
    expect(localStorage.getItem('tb303-save:autosave')).toBeNull();
  });

  it('returns null for an id that is not there', async () => {
    expect(await loadEntry('nope')).toBeNull();
    expect(await loadAutosave()).toBeNull();
  });

  it('deleteEntry drops both the index row and the payload', async () => {
    const entry = await saveNamedEntry('Alpha', { bpm: 128 });
    await deleteEntry(entry.id);

    expect(readIndex()).toEqual([]);
    expect(await loadEntry(entry.id)).toBeNull();
  });

  it('clearAll wipes the entries but preserves the autosave, as the dialog promises', async () => {
    await saveNamedEntry('Alpha', { bpm: 128 });
    await saveNamedEntry('Beta', { bpm: 140 });
    await clearAll();

    expect(readIndex()).toEqual([]);
    expect(await loadAutosave()).toEqual({ bpm: 140 });
  });

  it('renameEntry touches the index only', async () => {
    const entry = await saveNamedEntry('Alpha', { bpm: 128 });
    renameEntry(entry.id, 'Renamed');

    expect(readIndex()[0].name).toBe('Renamed');
    expect(await loadEntry(entry.id)).toEqual({ bpm: 128 });
  });

  it('a failed write leaves no orphan row in the index', async () => {
    // The old order was index-then-payload, so every QuotaExceededError left a
    // row in the list that loaded as null. Payload first, index second.
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('boom'); });

    await expect(saveNamedEntry('Doomed', { bpm: 128 })).rejects.toThrow();
    expect(readIndex()).toEqual([]);
  });
});

describe('migrateLegacySaves', () => {
  it('moves localStorage payloads into IndexedDB and frees the keys', async () => {
    localStorage.setItem(INDEX_KEY, JSON.stringify([
      { id: 'a', name: 'Alpha', timestamp: 1_000, sizeKB: 1 },
    ]));
    localStorage.setItem('tb303-save:a', JSON.stringify({ bpm: 111 }));
    localStorage.setItem('tb303-save:autosave', JSON.stringify({ bpm: 222 }));

    await migrateLegacySaves();

    expect(await loadEntry('a')).toEqual({ bpm: 111 });
    expect(await loadAutosave()).toEqual({ bpm: 222 });
    expect(localStorage.getItem('tb303-save:a')).toBeNull();
    expect(localStorage.getItem('tb303-save:autosave')).toBeNull();
    expect(readIndex().map((e) => e.id)).toEqual(['a']);
  });

  it('drops index rows whose payload never made it to disk', async () => {
    // Exactly what a full localStorage left behind: the index row was written
    // before the payload, so the failed saves show up as unloadable rows.
    localStorage.setItem(INDEX_KEY, JSON.stringify([
      { id: 'real',  name: 'Real',  timestamp: 1_000, sizeKB: 1 },
      { id: 'ghost', name: 'Ghost', timestamp: 2_000, sizeKB: 9 },
    ]));
    localStorage.setItem('tb303-save:real', JSON.stringify({ bpm: 111 }));

    await migrateLegacySaves();

    expect(readIndex().map((e) => e.id)).toEqual(['real']);
    expect(totalStorageKB()).toBe(1);
  });

  it('leaves an already-migrated store alone', async () => {
    const entry = await saveNamedEntry('Alpha', { bpm: 128 });
    await migrateLegacySaves();

    expect(readIndex().map((e) => e.id)).toEqual([entry.id]);
    expect(await loadEntry(entry.id)).toEqual({ bpm: 128 });
  });
});
