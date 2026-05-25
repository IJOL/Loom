// Cosmic arpeggiator. Hooks into any tonal track (melody / bass): when a step
// plays a note, instead of a single trigger we schedule a sequence of notes
// built from a scale around that root, at the arp rate, for the duration of
// the step's gate. The actual synth trigger is supplied by the caller, so the
// same arp engine works for the polysynth, the TB-303 bass, or anything else.

import { type SyncDiv, syncDivToHz } from './fx';

export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'cosmic';
export type ArpScale   = 'major' | 'minor' | 'pentMinor' | 'phrygian' | 'chromatic';
// ArpScope: list of lane IDs the arp intercepts. Each lane id matches one of
// the host's lane identifiers ('bass' for the 303, 'main' for the main poly,
// 'poly1'..'polyN' for extras). Empty array = arp has no source even if enabled.
export type ArpScope   = string[];

export type ArpTriggerFn = (note: number, time: number, gateDuration: number, accent: boolean) => void;

const SCALE_INTERVALS: Record<ArpScale, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export interface ArpSettings {
  enabled: boolean;
  scope: ArpScope;           // lane ids the arp intercepts (e.g. ['main','poly1'])
  pattern: ArpPattern;
  rate: SyncDiv | 'free';    // 'off' is treated as 'free'
  rateFreeHz: number;        // used when rate === 'free'
  octaves: number;           // 1..4
  gate: number;              // 0.05..1.0  (fraction of arp interval the note holds)
  scale: ArpScale;
}

export const ARP_DEFAULTS: ArpSettings = {
  enabled: false,
  scope: ['main'],
  pattern: 'up',
  rate: '1/16',
  rateFreeHz: 8,
  octaves: 2,
  gate: 0.7,
  scale: 'pentMinor',
};

// Build the pool of MIDI notes spanning `octaves` octaves above `root` on `scale`.
function buildPool(root: number, scale: ArpScale, octaves: number): number[] {
  const intervals = SCALE_INTERVALS[scale];
  const pool: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const iv of intervals) pool.push(root + iv + oct * 12);
  }
  return pool;
}

export function generateArpSequence(root: number, pattern: ArpPattern, octaves: number, scale: ArpScale, count: number): number[] {
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
      const seq = pool.length > 1
        ? [...pool, ...pool.slice(1, -1).reverse()]
        : pool;
      for (let i = 0; i < count; i++) out.push(seq[i % seq.length]);
      break;
    }
    case 'random':
      for (let i = 0; i < count; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
      break;
    case 'cosmic': {
      // Random walk on the pool with occasional teleports for "cosmic" feel.
      let idx = Math.floor(Math.random() * pool.length);
      for (let i = 0; i < count; i++) {
        // Occasionally jump up an octave outside the pool for sparkle.
        if (Math.random() < 0.08) {
          out.push(pool[idx] + 12);
        } else {
          out.push(pool[idx]);
        }
        if (Math.random() < 0.18) {
          idx = Math.floor(Math.random() * pool.length); // teleport
        } else {
          idx += Math.random() < 0.5 ? -1 : 1;
          if (idx < 0) idx = pool.length - 1;            // wrap
          if (idx >= pool.length) idx = 0;
        }
      }
      break;
    }
  }
  return out;
}

export function arpIntervalSec(arp: ArpSettings, bpm: number): number {
  if (arp.rate === 'free' || arp.rate === 'off') {
    return 1 / Math.max(0.001, arp.rateFreeHz);
  }
  const hz = syncDivToHz(bpm, arp.rate);
  return hz > 0 ? 1 / hz : 1 / Math.max(0.001, arp.rateFreeHz);
}

// Schedule the arp using the given triggerFn (lets callers wire any synth).
// If arp is disabled, the function still calls triggerFn once for the root note.
export function scheduleArpForNote(
  trigger: ArpTriggerFn,
  arp: ArpSettings,
  bpm: number,
  rootNote: number,
  time: number,
  totalGateDuration: number,
  accent: boolean,
) {
  if (!arp.enabled) {
    trigger(rootNote, time, totalGateDuration, accent);
    return;
  }
  const intervalSec = arpIntervalSec(arp, bpm);
  const noteGate = Math.max(0.01, intervalSec * arp.gate);
  const numNotes = Math.max(1, Math.floor(totalGateDuration / intervalSec));
  const notes = generateArpSequence(rootNote, arp.pattern, arp.octaves, arp.scale, numNotes);
  for (let i = 0; i < numNotes; i++) {
    trigger(notes[i], time + i * intervalSec, noteGate, accent && i === 0);
  }
}
