// Enumerate the (sampleId, ratio) stretch jobs implied by the current session
// + tempo, so the BPM broadcaster can re-render+cache them. Pure.

import type { SessionState } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

export interface StretchJob { sampleId: string; ratio: number; trimStart: number; trimEnd: number; }

export function collectStretchJobs(state: SessionState, bpm: number, meter: TimeSignature): StretchJob[] {
  const jobs: StretchJob[] = [];
  const seen = new Set<string>();
  const secPerBeat = 60 / bpm;
  for (const lane of state.lanes) {
    for (const clip of lane.clips) {
      const s = clip?.sample;
      if (!s || s.mode !== 'loop' || !s.warp || s.warpMode !== 'stretch') continue;
      const region = Math.max(0.001, (s.trimEnd || 0) - (s.trimStart || 0));
      const gate = clip!.lengthBars * quartersPerBar(meter) * secPerBeat;
      const ratio = gate / region;
      const key = `${s.sampleId}|${ratio.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ sampleId: s.sampleId, ratio, trimStart: s.trimStart, trimEnd: s.trimEnd });
    }
  }
  return jobs;
}
