// src/session/example-loader.ts
// Galería de ejemplos (estilo Classic). Los melódicos se guardan en GRADOS de
// escala → encajan en cualquier tonalidad; los beats en notas GM tal cual.
import { scaleDegreeToMidi, midiToScaleDegree, snapToScale, type ScaleId, type StyleId } from '../core/musicality';
import { type NoteEvent } from '../core/notes';

export interface ExampleDegree { start: number; duration: number; degree: number; octave: number; velocity: number; }
export interface Example {
  id: string; name: string; style: StyleId; kind: 'bass' | 'melody' | 'beat'; bars: number;
  degrees?: ExampleDegree[];   // melódicos
  notes?: NoteEvent[];         // beats (GM)
  source?: 'user' | 'factory';
}
interface ExampleFile { style: StyleId; examples: unknown[]; }

export function validateExample(raw: unknown): raw is Example {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return false;
  if (typeof r.bars !== 'number') return false;
  if (r.kind !== 'bass' && r.kind !== 'melody' && r.kind !== 'beat') return false;
  if (r.source !== undefined && r.source !== 'user' && r.source !== 'factory') return false;
  return Array.isArray(r.degrees) || Array.isArray(r.notes);
}

const TICKS_PER_BAR_DEFAULT = 384; // 4/4 @ 16ths: 16 steps × 24 ticks

/** Render an example into concrete NoteEvent[] for the given tonality.
 *  Optional clipBars + ticksPerBar enable length adaptation:
 *  - If clipBars > ex.bars: the natural block is repeated to fill the clip.
 *  - If clipBars < ex.bars: notes are trimmed to [0, clipBars*ticksPerBar).
 *    Notes that start before but end after the boundary are duration-clamped.
 *  - If clipBars is omitted: behaves exactly as before (back-compat). */
export function renderExampleNotes(
  ex: Example,
  ton: { key: number; scale: ScaleId },
  octaveBase: number,
  clipBars?: number,
  ticksPerBar: number = TICKS_PER_BAR_DEFAULT,
): NoteEvent[] {
  // Render the natural notes (one full pass of the example).
  const naturalNotes: NoteEvent[] = ex.notes
    ? ex.notes.map((n) => ({ ...n }))
    : (ex.degrees ?? []).map((d) => ({
        start: d.start,
        duration: d.duration,
        velocity: d.velocity,
        midi: scaleDegreeToMidi(d.degree + d.octave * 7, octaveBase, ton.key, ton.scale),
      }));

  // No length adaptation requested → return as-is (exact back-compat).
  if (clipBars === undefined) return naturalNotes;

  const naturalTicks = ex.bars * ticksPerBar;
  const clipTicks = clipBars * ticksPerBar;

  const out: NoteEvent[] = [];
  let k = 0;
  // Repeat the block until we've covered clipTicks.
  while (k * naturalTicks < clipTicks) {
    const offset = k * naturalTicks;
    for (const n of naturalNotes) {
      const start = n.start + offset;
      if (start >= clipTicks) continue; // drop notes starting at or after clip end
      const end = start + n.duration;
      const duration = end > clipTicks ? clipTicks - start : n.duration;
      out.push({ ...n, start, duration });
    }
    k++;
  }
  return out;
}

// ── localStorage user examples ───────────────────────────────────────────────

function lsKey(style: StyleId): string {
  return `loom.examples.${style}`;
}

/** Read user examples for a style from localStorage. Never throws; returns [] on error. */
export function loadUserExamples(style: StyleId): Example[] {
  try {
    const raw = localStorage.getItem(lsKey(style));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(validateExample) as Example[];
  } catch {
    return [];
  }
}

/** Append a validated example to localStorage. Throws on invalid input. */
export function saveUserExample(ex: Example): void {
  if (!validateExample(ex)) throw new Error(`saveUserExample: invalid example (id=${(ex as Record<string, unknown>).id})`);
  const existing = loadUserExamples(ex.style);
  existing.push(ex);
  try {
    localStorage.setItem(lsKey(ex.style), JSON.stringify(existing));
  } catch {
    throw new Error('No se pudo guardar el ejemplo: almacenamiento del navegador lleno o no disponible.');
  }
}

/** Remove an example by id from localStorage for the given style. No-op if not found. */
export function deleteUserExample(style: StyleId, id: string): void {
  const existing = loadUserExamples(style);
  const filtered = existing.filter((e) => e.id !== id);
  if (filtered.length === existing.length) return; // nothing removed → skip the write
  try {
    localStorage.setItem(lsKey(style), JSON.stringify(filtered));
  } catch { /* best-effort delete; ignore storage errors */ }
}

// ── Factory examples (with source stamp) ────────────────────────────────────

const cache = new Map<StyleId, Example[]>();

export async function loadExamples(style: StyleId): Promise<Example[]> {
  if (cache.has(style)) return cache.get(style)!;
  const url = `${import.meta.env.BASE_URL}examples/${style}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const body = (await res.json()) as ExampleFile;
  const out = (body.examples ?? [])
    .filter(validateExample)
    .map((e) => ({ ...(e as Example), source: 'factory' as const }));
  cache.set(style, out);
  return out;
}

/** All examples = factory (awaited) concat user (from localStorage). */
export async function loadAllExamples(style: StyleId): Promise<Example[]> {
  const factory = await loadExamples(style);
  const user = loadUserExamples(style);
  return [...factory, ...user];
}

export function __resetExampleCache(): void { cache.clear(); }

// ── clipToExample + exampleToJson ─────────────────────────────────────────────

export interface ClipToExampleOpts {
  id: string;
  name: string;
  style: StyleId;
  kind: 'bass' | 'melody' | 'beat';
  notes: NoteEvent[];
  bars: number;
  ton: { key: number; scale: ScaleId };
  octaveBase: number;
  ticksPerBar?: number;
}

/** Convert a clip's NoteEvent[] into a portable Example.
 *  For melodic kinds ('bass'/'melody'): each note is converted to an ExampleDegree
 *  using midiToScaleDegree (with octave folded into the degree; octave field = 0).
 *  Out-of-scale notes are snapped first.
 *  For 'beat': notes are stored as-is (GM midi). */
export function clipToExample(opts: ClipToExampleOpts): Example {
  const { id, name, style, kind, notes, bars, ton, octaveBase } = opts;

  if (kind === 'beat') {
    return {
      id, name, style, kind, bars,
      notes: notes.map((n) => ({ ...n })),
      source: 'user',
    };
  }

  // Melodic: convert each note midi to a scale degree (octave folded in).
  const degrees: ExampleDegree[] = notes.map((n) => {
    const snapped = snapToScale(n.midi, ton.key, ton.scale);
    const degree = midiToScaleDegree(snapped, ton.key, ton.scale, octaveBase);
    return {
      start: n.start,
      duration: n.duration,
      degree,
      octave: 0, // degree already encodes the octave; octave field unused
      velocity: n.velocity,
    };
  });

  return { id, name, style, kind, bars, degrees, source: 'user' };
}

/** Serialize an Example to pretty-printed JSON (for download/export). */
export function exampleToJson(ex: Example): string {
  return JSON.stringify(ex, null, 2);
}
