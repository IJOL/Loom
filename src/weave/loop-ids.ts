// How WEAVE names a loop.
//
// A weave draws from two places and has to hold both in one selection: the
// lane's OWN clips, and the pattern library — hundreds of named loops per style,
// which is the reason this panel exists at all. One vocabulary rather than two
// parallel lists, so a selection can mix them freely: A a library breakbeat, B
// the clip you just played in.
//
// The string form is what gets saved, so it is deliberately boring: a prefix,
// then the fields, colon-separated. Pure — no library, no session, no DOM.

import type { StyleId } from '../core/musicality';
import type { PatternKind } from '../patterns/pattern-library';

export type LoopId =
  | { source: 'clip'; clipId: string }
  | { source: 'pattern'; style: StyleId; kind: PatternKind; index: number };

const PATTERN_KINDS: PatternKind[] = ['drums', 'bass', 'synth'];

export function formatLoopId(l: LoopId): string {
  return l.source === 'clip'
    ? `clip:${l.clipId}`
    : `lib:${l.style}:${l.kind}:${l.index}`;
}

/** Read an id back. Returns null for anything malformed rather than a guess —
 *  a save from a future build must fail to resolve, not resolve to the wrong
 *  loop. The caller already substitutes an unresolvable loop. */
export function parseLoopId(id: string): LoopId | null {
  if (id.startsWith('clip:')) {
    const clipId = id.slice(5);
    return clipId ? { source: 'clip', clipId } : null;
  }
  if (!id.startsWith('lib:')) return null;

  // A clip id may contain colons, a library id may not — so the library form is
  // split from the RIGHT: style, then kind, then index.
  const parts = id.slice(4).split(':');
  if (parts.length < 3) return null;
  const index = Number(parts[parts.length - 1]);
  const kind = parts[parts.length - 2] as PatternKind;
  const style = parts.slice(0, -2).join(':') as StyleId;
  if (!style || !PATTERN_KINDS.includes(kind)) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return { source: 'pattern', style, kind, index };
}
