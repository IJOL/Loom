import { StemClient } from './stem-client';
import { pollJob } from './stem-poll';
import { planStemLanes } from './stem-lane-plan';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { sampleStore } from '../samples/store-singleton';
import { sampleCache } from '../samples/sample-cache';
import { detectLoop } from '../samples/loop-analysis';
import { DEFAULT_METER, type TimeSignature } from '../core/meter';

export interface StemImportDeps {
  ctx: AudioContext;
  client: StemClient;
  addStemLanes: (
    stems: { label: string; sampleId: string; durationSec: number }[],
    opts?: { replace?: boolean },
  ) => void;
  /** Transcribe one stem's audio to a note/drums lane (label = lane name).
   *  `kind` is the known stem role: 'drums' for the drum stem, 'melodic' otherwise. */
  transcribeStem?: (file: File, label: string, kind: 'melodic' | 'drums') => Promise<void>;
  /** Optional: conform the session tempo to the imported audio. Called once after
   *  decoding with the BPM detected from the DRUMS stem (most reliable for tempo),
   *  falling back to the longest stem. Wire it to the canonical BPM setter so the
   *  scheduler, UI and tempo-locked engines all update. Omitted ⇒ BPM unchanged. */
  setSessionBpm?: (bpm: number) => void;
  /** Current session meter, so tempo detection snaps to the right bar length.
   *  A getter keeps it live (the meter can change between imports). */
  getMeter?: () => TimeSignature;
}

export interface StemImportCallbacks {
  onProgress?: (status: string, progress: number | null) => void;
  signal?: AbortSignal;
  /** Replace the whole session with the stems instead of adding lanes. */
  replace?: boolean;
}

/** Full flow: upload -> poll -> decode all stems -> create lanes (all-or-nothing). */
export async function importStems(
  deps: StemImportDeps,
  file: File,
  cb: StemImportCallbacks = {},
): Promise<void> {
  const jobId = await deps.client.createJob(file);
  let done;
  try {
    done = await pollJob(() => deps.client.getJob(jobId), {
      onProgress: cb.onProgress, signal: cb.signal,
    });
  } catch (err) {
    if (cb.signal?.aborted) await deps.client.cancelJob(jobId);
    throw err;
  }

  const plan = planStemLanes(done.stems ?? []);

  // Decode ALL stems before creating any lane (all-or-nothing).
  const decoded = await Promise.all(plan.map(async (p) => {
    const res = await fetch(deps.client.stemUrl(p.url));
    if (!res.ok) throw new Error(`stem download failed: ${p.name} (HTTP ${res.status})`);
    const bytes = await res.arrayBuffer();
    const buffer = await deps.ctx.decodeAudioData(bytes.slice(0));
    return { plan: p, bytes, buffer };
  }));

  const lanes = decoded.map(({ plan: p, bytes, buffer }) => {
    const asset = buildSampleAsset({
      id: newSampleId(), name: p.label, mime: 'audio/wav',
      bytes, buffer, createdAt: Date.now(),
    });
    sampleCache.put(asset.id, buffer);          // so the sampler finds it immediately
    void sampleStore.put(asset);                // persist for reload (fire-and-forget)
    return { label: p.label, sampleId: asset.id, durationSec: buffer.duration };
  });

  deps.addStemLanes(lanes, { replace: cb.replace });

  // Conform the session tempo to the imported audio: detect from the DRUMS stem
  // (most reliable for tempo), else the longest decoded stem. detectLoop already
  // folds octaves into [70,180] and snaps to whole bars; we only set when the
  // chosen buffer has real audio so an empty/silent stem can't force BPM.
  if (deps.setSessionBpm) {
    const tempoBuf = pickTempoBuffer(decoded);
    if (tempoBuf && tempoBuf.length > 0 && tempoBuf.duration > 0) {
      const meter = deps.getMeter?.() ?? DEFAULT_METER;
      const { originalBpm } = detectLoop(tempoBuf, meter);
      if (Number.isFinite(originalBpm) && originalBpm > 0) deps.setSessionBpm(originalBpm);
    }
  }

  // Always also transcribe each stem to a note/drums lane — every separation
  // yields both the audio (Sampler) and the notes for remixing.
  if (deps.transcribeStem) {
    cb.onProgress?.('transcribing', null);
    for (const { plan: p, bytes } of decoded) {
      const file = new File([bytes], `${p.label}.wav`, { type: 'audio/wav' });
      const kind = p.name === 'drums' ? 'drums' : 'melodic';
      await deps.transcribeStem(file, `Notas: ${p.label}`, kind);
    }
  }
}

type DecodedStem = { plan: { name: string }; buffer: AudioBuffer };

/** Pick the stem whose tempo best represents the track: the drums stem if the
 *  separation produced one (percussive onsets give the cleanest autocorrelation),
 *  otherwise the longest decoded stem (the first when durations tie). */
function pickTempoBuffer<T extends DecodedStem>(decoded: T[]): AudioBuffer | null {
  if (decoded.length === 0) return null;
  const drums = decoded.find((d) => d.plan.name === 'drums');
  if (drums) return drums.buffer;
  let best = decoded[0];
  for (const d of decoded) if (d.buffer.duration > best.buffer.duration) best = d;
  return best.buffer;
}
