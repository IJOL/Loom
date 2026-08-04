// src/save/save-store.ts
// IndexedDB-backed store for save PAYLOADS (the serialized session JSON).
//
// Why not localStorage: it is capped at ~5 MB per origin, the cap is not
// raisable by any API or flag, and a handful of sessions carrying Performance
// automation curves went straight through it — every further save threw
// QuotaExceededError and was lost. IndexedDB's quota is a share of the disk.
//
// One object store keyed by the save id. The INDEX (name/date/size) is NOT here:
// it stays in localStorage, where it costs nothing and can be read synchronously
// so the Save Manager list renders without awaiting.
//
// `indexedDB` is touched lazily, inside these functions only — never at module
// scope — so importing the save layer stays safe in environments without it.

const DB_NAME = 'tb303-saves';
const STORE = 'entries';
const VERSION = 1;

interface SaveRecord { id: string; json: string; }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function putPayload(id: string, json: string): Promise<void> {
  await run('readwrite', (s) => s.put({ id, json } as SaveRecord) as IDBRequest<IDBValidKey>);
}

export async function getPayload(id: string): Promise<string | null> {
  const rec = await run('readonly', (s) => s.get(id) as IDBRequest<SaveRecord | undefined>);
  return rec?.json ?? null;
}

export async function deletePayload(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}

export async function listPayloadIds(): Promise<string[]> {
  const keys = await run('readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
  return keys.map(String);
}
