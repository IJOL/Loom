// src/app/warp-resync.ts
// Enumerate the warp re-render jobs implied by the session + tempo, so the BPM
// broadcaster can re-render+cache the piecewise-warped buffers. Pure.
import type { SessionState, WarpMarker } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

export interface WarpJob { sampleId: string; markers: WarpMarker[]; gate: number; }

export function collectWarpJobs(state: SessionState, bpm: number, meter: TimeSignature): WarpJob[] {
  const jobs: WarpJob[] = [];
  const secPerBeat = 60 / bpm;
  for (const lane of state.lanes) {
    for (const clip of lane.clips) {
      const s = clip?.sample;
      if (!s || !s.warp || !s.warpMarkers || s.warpMarkers.length < 2) continue;
      const gate = clip!.lengthBars * quartersPerBar(meter) * secPerBeat;
      jobs.push({ sampleId: s.sampleId, markers: s.warpMarkers, gate });
    }
  }
  return jobs;
}
