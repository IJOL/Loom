// localStorage-backed save manager: named entries, autosave, downloads.

const INDEX_KEY = 'tb303-saves';
const ENTRY_KEY = (id: string) => `tb303-save:${id}`;
const AUTOSAVE_KEY = 'tb303-save:autosave';

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

export function saveNamedEntry(name: string, state: unknown): SaveIndexEntry {
  const json = JSON.stringify(state);
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sizeKB = Math.round(json.length / 1024);
  const entry: SaveIndexEntry = { id, name, timestamp: Date.now(), sizeKB };
  const idx = readIndex();
  idx.push(entry);
  writeIndex(idx);
  localStorage.setItem(ENTRY_KEY(id), json);
  localStorage.setItem(AUTOSAVE_KEY, json);
  return entry;
}

export function loadEntry(id: string): unknown | null {
  try {
    const raw = localStorage.getItem(ENTRY_KEY(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadAutosave(): unknown | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteEntry(id: string): void {
  const idx = readIndex().filter((e) => e.id !== id);
  writeIndex(idx);
  localStorage.removeItem(ENTRY_KEY(id));
}

export function renameEntry(id: string, name: string): void {
  const idx = readIndex();
  const e = idx.find((x) => x.id === id);
  if (e) { e.name = name; writeIndex(idx); }
}

export function clearAll(): void {
  for (const e of readIndex()) localStorage.removeItem(ENTRY_KEY(e.id));
  writeIndex([]);
}

export function totalStorageKB(): number {
  let total = 0;
  for (const e of readIndex()) total += e.sizeKB;
  return total;
}

export function downloadAsJson(filename: string, state: unknown): void {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function loadFromFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}
