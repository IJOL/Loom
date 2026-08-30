// src/performance/perf-ingest.ts
// The PRIMARY gesture: drop an audio file onto the Arrange surface, get an
// Audio lane whose clip is bar-fitted to the session tempo, and a band on the
// timeline where it landed. The heavy lifting is all reuse — the stems
// pipeline stores/decodes the sample, addStemLanes builds the undoable lane +
// audioChannelClip (whose originalBpm IS the tempo fit: bpm / stretch), and
// the band is ordinary arrangement data.
import { fitLoopToBars } from './loop-fit';
import type { TimeSignature } from '../core/meter';
import { songBarSec } from '../core/song-position';

export interface DropPlan {
  label: string;
  bars: number;
  /** The "original tempo" the fitted loop is declared at: session bpm ÷
   *  stretch. audioChannelClip's warp then locks it to the session grid. */
  originalBpm: number;
}

/** Pure half of the drop: name the lane after the file, fit the duration. */
export function planDrop(
  fileName: string, durationSec: number, bpm: number, meter: TimeSignature,
): DropPlan {
  const label = fileName.replace(/\.[a-z0-9]+$/i, '') || 'Loop';
  const fit = fitLoopToBars(durationSec, bpm, meter);
  return { label, bars: fit.bars, originalBpm: bpm / fit.stretch };
}

export interface PerfIngestDeps {
  bpm(): number;
  meter(): TimeSignature;
  pxPerBar(): number;
  /** Create the Audio lane + fitted clip (the session side, one undo entry).
   *  Returns the created ids, or null when the session refused. */
  addLoopLane(input: {
    label: string; sampleId: string; durationSec: number; originalBpm: number;
  }): { laneId: string; clipId: string } | null;
  /** Land the band on the timeline (the arrangement side). */
  addBand(laneId: string, clipId: string, atSec: number, durSec: number): void;
  /** Store + decode one dropped file; resolves with the cache id. */
  importFile(file: File): Promise<{ sampleId: string; durationSec: number } | null>;
  refresh(): void;
}

/** One decoded file → lane + clip + band at `atSec` (bar-snapped upstream). */
export function ingestDroppedFile(
  deps: PerfIngestDeps,
  file: { name: string; sampleId: string; durationSec: number },
  atSec: number,
): void {
  const plan = planDrop(file.name, file.durationSec, deps.bpm(), deps.meter());
  const created = deps.addLoopLane({
    label: plan.label, sampleId: file.sampleId,
    durationSec: file.durationSec, originalBpm: plan.originalBpm,
  });
  if (!created) return;
  const durSec = plan.bars * songBarSec(deps.bpm(), deps.meter());
  deps.addBand(created.laneId, created.clipId, atSec, durSec);
  deps.refresh();
}

const AUDIO_RE = /\.(wav|mp3|flac|ogg|m4a|aiff?)$/i;

/** Wire drag & drop on the persistent host. Every drop lands sequentially
 *  (each file its own lane, side by side from the drop bar). */
export function attachPerfDrop(root: HTMLElement, deps: PerfIngestDeps): () => void {
  const setHot = (on: boolean) => {
    root.querySelector('.perf-dropzone')?.classList.toggle('drop-hot', on);
  };
  const dropBarSec = (clientX: number): number => {
    const track = root.querySelector('.perf-ruler .perf-track') as HTMLElement | null;
    const barSec = songBarSec(deps.bpm(), deps.meter());
    if (!track) return 0;
    const bar = Math.max(0, Math.floor((clientX - track.getBoundingClientRect().left) / deps.pxPerBar()));
    return bar * barSec;
  };
  const onOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setHot(true);
  };
  const onLeave = () => setHot(false);
  const onDrop = (e: DragEvent) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => AUDIO_RE.test(f.name));
    if (files.length === 0) return;
    e.preventDefault();
    setHot(false);
    const atSec = dropBarSec(e.clientX);
    void (async () => {
      let at = atSec;
      for (const f of files) {
        const imported = await deps.importFile(f);
        if (!imported) continue;
        ingestDroppedFile(deps, { name: f.name, ...imported }, at);
        // The next dropped file starts a fresh lane at the same bar.
        at = atSec;
      }
    })();
  };
  root.addEventListener('dragover', onOver);
  root.addEventListener('dragleave', onLeave);
  root.addEventListener('drop', onDrop);
  return () => {
    root.removeEventListener('dragover', onOver);
    root.removeEventListener('dragleave', onLeave);
    root.removeEventListener('drop', onDrop);
  };
}
