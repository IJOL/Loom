import type { StemRef } from './stem-client';

const LABELS: Record<string, string> = {
  vocals: 'Vocals', drums: 'Drums', bass: 'Bass', other: 'Other',
};
const ORDER = ['vocals', 'drums', 'bass', 'other'];

export interface StemLanePlan { name: string; url: string; label: string; }

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Map a stem manifest to an ordered, labelled lane plan: known stems first in
 *  canonical order with Spanish labels, unknown stems appended in input order. */
export function planStemLanes(stems: StemRef[]): StemLanePlan[] {
  const known = ORDER
    .map((n) => stems.find((s) => s.name === n))
    .filter((s): s is StemRef => Boolean(s))
    .map((s) => ({ name: s.name, url: s.url, label: LABELS[s.name] }));
  const unknown = stems
    .filter((s) => !ORDER.includes(s.name))
    .map((s) => ({ name: s.name, url: s.url, label: cap(s.name) }));
  return [...known, ...unknown];
}
