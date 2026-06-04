// Pure orchestrator: choose tempo + slice points from embedded metadata when
// present, else from detection, then build the slice/clip data. The browser
// drop handler (sampler UI) wires the real parse + decode + detect.

import type { LoopMetadata } from './loop-metadata';
import type { LoopAnalysis } from './loop-analysis';
import { buildSliceClip, type SliceClipResult } from '../core/slice-clip';
import type { TimeSignature } from '../core/meter';
import type { ResolutionKey } from '../core/drum-grid-editing';

export function analyzeLoopFor(opts: {
  durationSec: number;
  projectMeter: TimeSignature;
  gridResolution: ResolutionKey;
  metadata: LoopMetadata | null;
  detect: () => LoopAnalysis;
}): SliceClipResult & { originalBpm: number } {
  const md = opts.metadata;
  const hasTempo = !!md && typeof md.originalBpm === 'number';
  const hasSlices = !!md && Array.isArray(md.slicePointsSec) && md.slicePointsSec.length > 0;

  let originalBpm: number;
  let slicePointsSec: number[];
  if (hasTempo && hasSlices) {
    originalBpm = md!.originalBpm!;
    slicePointsSec = md!.slicePointsSec!;
  } else {
    const det = opts.detect();
    originalBpm = hasTempo ? md!.originalBpm! : det.originalBpm;
    slicePointsSec = hasSlices ? md!.slicePointsSec! : det.slicePointsSec;
  }

  const built = buildSliceClip({
    slicePointsSec,
    durationSec: opts.durationSec,
    originalBpm,
    projectMeter: opts.projectMeter,
    gridResolution: opts.gridResolution,
  });
  return { ...built, originalBpm };
}
