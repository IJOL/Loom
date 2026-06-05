import { StemClient } from './stem-client';
import { pollJob } from './stem-poll';
import { planStemLanes } from './stem-lane-plan';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { sampleStore } from '../samples/store-singleton';
import { sampleCache } from '../samples/sample-cache';

export interface StemImportDeps {
  ctx: AudioContext;
  client: StemClient;
  addStemLanes: (stems: { label: string; sampleId: string; durationSec: number }[]) => void;
}

export interface StemImportCallbacks {
  onProgress?: (status: string, progress: number | null) => void;
  signal?: AbortSignal;
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

  deps.addStemLanes(lanes);
}
