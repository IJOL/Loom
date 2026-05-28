import { stepsToNotes, bassStepsToNotes, notesToBassSteps, notesToPolySteps, type NoteEvent } from '../core/notes';
import type { Sequencer } from '../core/sequencer';

// ── Copy notes between lanes (303 ↔ main poly ↔ extra polys) ─────────────

export interface CopyNotesDeps {
  seq: Sequencer;
}

export interface CopyEndpoint { id: string; label: string; }

export function listCopyEndpoints(deps: CopyNotesDeps): CopyEndpoint[] {
  const { seq } = deps;
  const out: CopyEndpoint[] = [
    { id: 'tb-303-1', label: `Bass 303 (${seq.pattern.bassMode})` },
    { id: 'subtractive-1', label: `Main Poly (${seq.pattern.polyMode})` },
  ];
  for (const t of seq.pattern.extraPolyTracks) {
    out.push({ id: t.id, label: `${t.name || t.id} (piano)` });
  }
  return out;
}

/** Read notes from any endpoint, converting from its native format. */
export function readEndpointAsNotes(deps: CopyNotesDeps, id: string): NoteEvent[] {
  const { seq } = deps;
  if (id === 'tb-303-1') {
    return seq.pattern.bassMode === 'piano'
      ? seq.pattern.bassNotes.map((n) => ({ ...n }))
      : bassStepsToNotes(seq.pattern.bass);
  }
  if (id === 'subtractive-1') {
    return seq.pattern.polyMode === 'piano'
      ? seq.pattern.polyNotes.map((n) => ({ ...n }))
      : stepsToNotes(seq.pattern.melody);
  }
  const extra = seq.pattern.extraPolyTracks.find((t) => t.id === id);
  return extra ? extra.notes.map((n) => ({ ...n })) : [];
}

/** Write notes to an endpoint, converting to its native format if needed. */
export function writeNotesToEndpoint(deps: CopyNotesDeps, id: string, notes: NoteEvent[]): void {
  const { seq } = deps;
  const cloned = notes.map((n) => ({ ...n }));
  if (id === 'tb-303-1') {
    if (seq.pattern.bassMode === 'piano') seq.pattern.bassNotes = cloned;
    else seq.pattern.bass = notesToBassSteps(cloned, seq.pattern.length);
    return;
  }
  if (id === 'subtractive-1') {
    if (seq.pattern.polyMode === 'piano') seq.pattern.polyNotes = cloned;
    else seq.pattern.melody = notesToPolySteps(cloned, seq.pattern.length);
    return;
  }
  const extra = seq.pattern.extraPolyTracks.find((t) => t.id === id);
  if (extra) extra.notes = cloned;
}

export function refreshCopyTrackSelects(deps: CopyNotesDeps): void {
  const fromSel = document.getElementById('copy-track-from') as HTMLSelectElement | null;
  const toSel   = document.getElementById('copy-track-to')   as HTMLSelectElement | null;
  if (!fromSel || !toSel) return;
  const endpoints = listCopyEndpoints(deps);
  const prevFrom = fromSel.value || 'tb-303-1';
  const prevTo   = toSel.value   || 'subtractive-1';
  fromSel.innerHTML = '';
  toSel.innerHTML = '';
  for (const e of endpoints) {
    const a = document.createElement('option'); a.value = e.id; a.textContent = e.label; fromSel.appendChild(a);
    const b = document.createElement('option'); b.value = e.id; b.textContent = e.label; toSel.appendChild(b);
  }
  if (endpoints.some((e) => e.id === prevFrom)) fromSel.value = prevFrom;
  if (endpoints.some((e) => e.id === prevTo))   toSel.value   = prevTo;
}

export function wireCopyNotesPanel(deps: CopyNotesDeps): void {
  refreshCopyTrackSelects(deps);
  const panel = document.querySelector('.copy-track-panel') as HTMLDetailsElement | null;
  // Refresh choices whenever the panel opens — extra polys can come and go.
  panel?.addEventListener('toggle', () => { if (panel.open) refreshCopyTrackSelects(deps); });
  const goBtn = document.getElementById('copy-track-go') as HTMLButtonElement | null;
  goBtn?.addEventListener('click', () => {
    const fromSel = document.getElementById('copy-track-from') as HTMLSelectElement | null;
    const toSel   = document.getElementById('copy-track-to')   as HTMLSelectElement | null;
    if (!fromSel || !toSel) return;
    if (fromSel.value === toSel.value) return;
    const notes = readEndpointAsNotes(deps, fromSel.value);
    writeNotesToEndpoint(deps, toSel.value, notes);
  });
}
