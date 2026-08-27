// src/notefx/arp-processor.ts
import { type SyncDiv, syncDivToHz } from '../core/sync-div';
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';
import { inScale, type ScaleId } from '../core/musicality';
import { arpStepSequence, parseArpSteps, DEFAULT_ARP_STEPS } from './arp-steps';

/** The five shapes, plus the one you WRITE.
 *
 *  `steps` is the only pattern that can rest, and the only one whose sequence
 *  comes from a param rather than from the pool's order. Everything else about
 *  it is the same walk — it draws from the same pool, in the same key, at the
 *  same rate. */
export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'cosmic' | 'steps';
/** The arp used to carry its own five-name scale list and its own interval
 *  table, both duplicates of the ones in core/musicality. It now names the
 *  session's tonality instead — 'global', the default — and keeps the fixed
 *  names for when you deliberately want a scale of your own.
 *
 *  'global' is not the same shape as the others, and that is the point. A
 *  fixed name walks intervals from the note you played: in C major, playing E
 *  gives E-F#-G#, which is E major and out of the key. Following the session
 *  walks the DEGREES OF THE KEY from that note upward: E-F-G-A-B. Sharing an
 *  interval table would have been the smaller change and it would not have
 *  been "in key" at all. */
export type ArpScale   = 'global' | 'major' | 'minor' | 'pentMinor' | 'phrygian' | 'chromatic';

export interface ArpProcessorParams {
  pattern: ArpPattern;
  scale: ArpScale;
  rate: SyncDiv | 'free';
  rateFreeHz: number;
  octaves: number;
  gate: number;        // fraction (0.05..1) of the arp interval the note holds
  /** The written pattern, read only when `pattern` is 'steps'. Pool INDICES and
   *  a dot for a rest — see ./arp-steps for why it is a string and why it is
   *  indices. */
  steps: string;
}

export const ARP_PROCESSOR_DEFAULTS: ArpProcessorParams = {
  // octaves: 1 by default — the arp walks the scale from the note you played and
  // never leaves its octave unless you ask for it. Climbing octaves is opt-in.
  pattern: 'up', scale: 'global', rate: '1/16', rateFreeHz: 8, octaves: 1, gate: 0.7,
  // The upward walk, written out. Switching PATTERN to 'steps' then changes
  // nothing until you edit it: you are handed what you already had rather than
  // an empty box.
  steps: DEFAULT_ARP_STEPS,
};

/** The fixed scales, rooted on the played note. Deliberately NOT reusing
 *  core/musicality's table: these are the arp's own five, and 'global' does
 *  not appear here because it has no fixed intervals — it asks the session. */
const SCALE_INTERVALS: Record<Exclude<ArpScale, 'global'>, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** The degrees of the session key at or above `root`, one octave of them.
 *  This is what 'global' means: the notes the KEY has, starting from the note
 *  you played — not a scale transposed onto it. */
function keyDegreesFrom(root: number, key: number, scale: ScaleId): number[] {
  const out: number[] = [];
  for (let n = root; n < root + 12 && out.length < 12; n++) {
    if (inScale(n, key, scale)) out.push(n - root);
  }
  // A key always has degrees; an empty pool would silence the arp outright.
  return out.length ? out : [0];
}

function buildPool(
  root: number, scale: ArpScale, octaves: number,
  tonality?: { key: number; scale: ScaleId },
): number[] {
  const intervals = scale === 'global'
    ? keyDegreesFrom(root, tonality?.key ?? 0, tonality?.scale ?? 'minor')
    : SCALE_INTERVALS[scale];
  const pool: number[] = [];
  // Octave-FIRST ordering: for each scale degree, emit it across ALL octaves
  // before moving to the next degree. This makes the OCT control audible even
  // on short notes (which only emit a few arp steps) — with the old
  // octave-LAST ordering the first steps never left octave 0, so OCT 1 vs 2+
  // sounded identical. For octaves === 1 this is the plain scale walk (no change).
  for (const iv of intervals) {
    for (let oct = 0; oct < octaves; oct++) pool.push(root + iv + oct * 12);
  }
  return pool;
}

/** The notes an arp plays, `count` of them.
 *
 *  `null` is a REST, and only the written pattern can produce one — the five
 *  shapes walk a pool and every position on a pool is a note. The type carries
 *  it for all six rather than being special-cased, so the caller has one thing
 *  to handle instead of a question about which pattern it asked for. */
export function generateArpSequence(
  root: number, pattern: ArpPattern, octaves: number, scale: ArpScale, count: number,
  tonality?: { key: number; scale: ScaleId },
  steps?: string,
): (number | null)[] {
  const pool = buildPool(root, scale, octaves, tonality);
  if (pattern === 'steps') {
    return arpStepSequence(parseArpSteps(steps ?? DEFAULT_ARP_STEPS), pool, count);
  }
  const out: number[] = [];
  switch (pattern) {
    case 'up':
      for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
      break;
    case 'down':
      for (let i = 0; i < count; i++) out.push(pool[pool.length - 1 - (i % pool.length)]);
      break;
    case 'updown': {
      const seq = pool.length > 1 ? [...pool, ...pool.slice(1, -1).reverse()] : pool;
      for (let i = 0; i < count; i++) out.push(seq[i % seq.length]);
      break;
    }
    case 'random':
      for (let i = 0; i < count; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
      break;
    case 'cosmic': {
      let idx = Math.floor(Math.random() * pool.length);
      for (let i = 0; i < count; i++) {
        if (Math.random() < 0.08) out.push(pool[idx] + 12);
        else out.push(pool[idx]);
        if (Math.random() < 0.18) idx = Math.floor(Math.random() * pool.length);
        else { idx += Math.random() < 0.5 ? -1 : 1; if (idx < 0) idx = pool.length - 1; if (idx >= pool.length) idx = 0; }
      }
      break;
    }
  }
  return out;
}

function intervalSec(p: ArpProcessorParams, bpm: number): number {
  if (p.rate === 'free') return 1 / Math.max(0.001, p.rateFreeHz);
  const hz = syncDivToHz(bpm, p.rate);
  return hz > 0 ? 1 / hz : 1 / Math.max(0.001, p.rateFreeHz);
}

export class ArpProcessor implements NoteFxProcessor {
  constructor(private params: ArpProcessorParams) {}

  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[] {
    const p = this.params;
    const out: NoteFxEvent[] = [];
    const interval = intervalSec(p, ctx.bpm);
    const noteGate = Math.max(0.01, interval * p.gate);
    for (const e of input) {
      const numNotes = Math.max(1, Math.floor(e.gate / interval));
      const notes = generateArpSequence(
        e.note, p.pattern, p.octaves, p.scale, numNotes,
        // No tonality in the context and scale 'global' ⇒ the fallback inside
        // buildPool. Nothing else can be done: the arp must emit something.
        ctx.key !== undefined && ctx.scale !== undefined
          ? { key: ctx.key, scale: ctx.scale }
          : undefined,
        p.steps,
      );
      for (let i = 0; i < numNotes; i++) {
        const note = notes[i];
        // A REST emits nothing and does NOT shift what follows: the pattern is
        // a grid, so a hole in it has to stay a hole. Splicing the rests out
        // would turn a written rhythm into a faster run of the same notes.
        if (note === null) continue;
        out.push({ note, time: e.time + i * interval, gate: noteGate, accent: e.accent && i === 0 });
      }
    }
    return out;
  }
}
