// src/session/example-loader.ts
// Galería de ejemplos (estilo Classic). Los melódicos se guardan en GRADOS de
// escala → encajan en cualquier tonalidad; los beats en notas GM tal cual.
import { scaleDegreeToMidi, type ScaleId, type StyleId } from '../core/musicality';
import { type NoteEvent } from '../core/notes';

export interface ExampleDegree { start: number; duration: number; degree: number; octave: number; velocity: number; }
export interface Example {
  id: string; name: string; style: StyleId; kind: 'bass' | 'melody' | 'beat'; bars: number;
  degrees?: ExampleDegree[];   // melódicos
  notes?: NoteEvent[];         // beats (GM)
}
interface ExampleFile { style: StyleId; examples: unknown[]; }

export function validateExample(raw: unknown): raw is Example {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return false;
  if (typeof r.bars !== 'number') return false;
  if (r.kind !== 'bass' && r.kind !== 'melody' && r.kind !== 'beat') return false;
  return Array.isArray(r.degrees) || Array.isArray(r.notes);
}

/** Render an example into concrete NoteEvent[] for the given tonality. */
export function renderExampleNotes(
  ex: Example, ton: { key: number; scale: ScaleId }, octaveBase: number,
): NoteEvent[] {
  if (ex.notes) return ex.notes.map((n) => ({ ...n }));        // beats: tal cual
  return (ex.degrees ?? []).map((d) => ({
    start: d.start, duration: d.duration, velocity: d.velocity,
    midi: scaleDegreeToMidi(d.degree + d.octave * 7, octaveBase, ton.key, ton.scale),
  }));
}

const cache = new Map<StyleId, Example[]>();
export async function loadExamples(style: StyleId): Promise<Example[]> {
  if (cache.has(style)) return cache.get(style)!;
  const url = `${import.meta.env.BASE_URL}examples/${style}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const body = (await res.json()) as ExampleFile;
  const out = (body.examples ?? []).filter(validateExample) as Example[];
  cache.set(style, out);
  return out;
}
export function __resetExampleCache(): void { cache.clear(); }
