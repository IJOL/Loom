// src/notefx/arp-processor.ts
import { type SyncDiv, syncDivToHz } from '../core/fx';
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';

export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'cosmic';
export type ArpScale   = 'major' | 'minor' | 'pentMinor' | 'phrygian' | 'chromatic';

export interface ArpProcessorParams {
  pattern: ArpPattern;
  scale: ArpScale;
  rate: SyncDiv | 'free';
  rateFreeHz: number;
  octaves: number;
  gate: number;        // fraction (0.05..1) of the arp interval the note holds
}

export const ARP_PROCESSOR_DEFAULTS: ArpProcessorParams = {
  pattern: 'up', scale: 'pentMinor', rate: '1/16', rateFreeHz: 8, octaves: 2, gate: 0.7,
};

const SCALE_INTERVALS: Record<ArpScale, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

function buildPool(root: number, scale: ArpScale, octaves: number): number[] {
  const intervals = SCALE_INTERVALS[scale];
  const pool: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const iv of intervals) pool.push(root + iv + oct * 12);
  }
  return pool;
}

export function generateArpSequence(
  root: number, pattern: ArpPattern, octaves: number, scale: ArpScale, count: number,
): number[] {
  const pool = buildPool(root, scale, octaves);
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
      const notes = generateArpSequence(e.note, p.pattern, p.octaves, p.scale, numNotes);
      for (let i = 0; i < numNotes; i++) {
        out.push({ note: notes[i], time: e.time + i * interval, gate: noteGate, accent: e.accent && i === 0 });
      }
    }
    return out;
  }
}
