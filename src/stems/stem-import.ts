import { StemClient } from './stem-client';
import { pollJob } from './stem-poll';
import { planStemLanes } from './stem-lane-plan';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { sampleStore } from '../samples/store-singleton';
import { sampleCache } from '../samples/sample-cache';
import { detectLoop } from '../samples/loop-analysis';
import { DEFAULT_METER, type TimeSignature } from '../core/meter';
import type { WarpMarker } from '../session/session';

export interface StemImportDeps {
  ctx: AudioContext;
  client: StemClient;
  addStemLanes: (
    stems: { label: string; sampleId: string; durationSec: number }[],
    opts?: { replace?: boolean; anchorSec?: number; warpMarkers?: WarpMarker[] },
  ) => void;
  /** Transcribe one stem's audio to a note/drums lane (label = lane name).
   *  `kind` is the known stem role: 'drums' for the drum stem, 'melodic' otherwise. */
  transcribeStem?: (file: File, label: string, kind: 'melodic' | 'drums') => Promise<void>;
  /** Optional: conform the session tempo to the imported audio. Called once
   *  BEFORE the lanes are built (so each clip's frozen lengthBars matches the new
   *  tempo) with the BPM detected from the DRUMS stem (most reliable for tempo),
   *  falling back to the longest stem that has audible energy. Only fires when the
   *  import REPLACES the session (cb.replace) — in ADD mode the project tempo is
   *  authoritative and left untouched. Wire it to the canonical BPM setter so the
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
  /** Transcribe each stem to a note/drums lane (default false; the dialog
   *  checkbox sets it). Audio→notes quality is rough, so it is opt-in. */
  transcribe?: boolean;
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

  // Detect tempo + downbeat from the best stem (drums, else longest with energy).
  // The anchor is applied to EVERY stem so they stay mutually phase-locked and
  // their shared downbeat lands on bar 1. BPM is conformed only when REPLACING —
  // in ADD mode the project tempo is authoritative.
  // Auto-warp is OFF: the naive per-beat marker seed mangled real songs (tempo
  // wobble / freezes from degenerate markers). Stems import NATIVE (Phase 2a) —
  // clean, with a small downbeat anchor. Warp markers return with the 2b-2 editor
  // (visible + draggable), where the user can see and correct them.
  let anchorSec = 0;
  const tempoBuf = pickTempoBuffer(decoded);
  if (tempoBuf && tempoBuf.length > 0 && tempoBuf.duration > 0) {
    const meter = deps.getMeter?.() ?? DEFAULT_METER;
    const { originalBpm, slicePointsSec } = detectLoop(tempoBuf, meter);
    anchorSec = pickDownbeatAnchor(slicePointsSec);
    if (deps.setSessionBpm && cb.replace && Number.isFinite(originalBpm) && originalBpm > 0) {
      deps.setSessionBpm(originalBpm);
    }
  }

  deps.addStemLanes(lanes, { replace: cb.replace, anchorSec });

  // Optional: transcribe each stem to a note/drums lane. Off by default — quality
  // is rough — so it only runs when the dialog checkbox sets cb.transcribe.
  if (deps.transcribeStem && cb.transcribe) {
    cb.onProgress?.('transcribing', null);
    for (const { plan: p, bytes } of decoded) {
      const file = new File([bytes], `${p.label}.wav`, { type: 'audio/wav' });
      const kind = p.name === 'drums' ? 'drums' : 'melodic';
      await deps.transcribeStem(file, `Notas: ${p.label}`, kind);
    }
  }
}

type DecodedStem = { plan: { name: string }; buffer: AudioBuffer };

// Below this peak amplitude a stem carries no usable onsets — detectLoop would
// return a bogus ~180 BPM (zero-confidence autocorrelation) from the silence.
// A drumless track's separated "drums" stem looks exactly like this. The floor
// is well under any real transient yet clears decode/dither noise.
const ENERGY_FLOOR = 1e-3;

/** Peak absolute sample across all channels — cheap proxy for "has audible
 *  energy". Returns 0 for an empty or all-zero buffer. */
function bufferPeak(buffer: AudioBuffer): number {
  if (buffer.length <= 0) return 0;
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

function hasEnergy(buffer: AudioBuffer): boolean {
  return bufferPeak(buffer) > ENERGY_FLOOR;
}

/** Pick the stem whose tempo best represents the track: the drums stem if the
 *  separation produced one AND it has audible energy (percussive onsets give the
 *  cleanest autocorrelation), otherwise the longest decoded stem that has energy
 *  (the first when durations tie). Returns null when no stem carries audio, so a
 *  silent separation can't override the project BPM. */
function pickTempoBuffer<T extends DecodedStem>(decoded: T[]): AudioBuffer | null {
  if (decoded.length === 0) return null;
  const drums = decoded.find((d) => d.plan.name === 'drums');
  if (drums && hasEnergy(drums.buffer)) return drums.buffer;
  let best: AudioBuffer | null = null;
  for (const d of decoded) {
    if (!hasEnergy(d.buffer)) continue;
    if (!best || d.buffer.duration > best.duration) best = d.buffer;
  }
  return best;
}

// A late "first onset" is detection noise or a long intro, not a downbeat — don't
// trim real audio away. The downbeat of 4/4 material sits well inside the first
// couple of seconds.
const MAX_ANCHOR_SEC = 2.0;

/** First detected onset (the downbeat to align to bar 1), or 0 when none lies
 *  within MAX_ANCHOR_SEC. */
export function pickDownbeatAnchor(slicePointsSec: number[]): number {
  const first = slicePointsSec.find((t) => t > 0);
  return first != null && first <= MAX_ANCHOR_SEC ? first : 0;
}
