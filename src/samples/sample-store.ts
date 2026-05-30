// src/samples/sample-store.ts
// IndexedDB-backed SampleStore. One object store keyed by SampleAsset.id.
// ArrayBuffer bytes survive structured-clone, so assets persist verbatim.

import type { SampleAsset, SampleStore } from './types';

const DEFAULT_DB = 'tb303-samples';
const STORE = 'samples';
const VERSION = 1;

export class IdbSampleStore implements SampleStore {
  constructor(private dbName: string = DEFAULT_DB) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, VERSION);
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

  private async run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async put(asset: SampleAsset): Promise<void> {
    await this.run('readwrite', (s) => s.put(asset) as IDBRequest<IDBValidKey>);
  }
  async get(id: string): Promise<SampleAsset | undefined> {
    return (await this.run('readonly', (s) => s.get(id) as IDBRequest<SampleAsset | undefined>)) ?? undefined;
  }
  async list(): Promise<SampleAsset[]> {
    return this.run('readonly', (s) => s.getAll() as IDBRequest<SampleAsset[]>);
  }
  async delete(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
  }
}
