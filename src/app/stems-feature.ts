// Stem separation and transcription — one client, two entry points.
//
// The cohesion is the `StemClient`: both callers here are the same
// `POST /transcribe` chain, and neither of them makes sense without the other's
// half of the setup. The Stems dialog separates a song into audio lanes and then
// transcribes each stem to a note/drums lane (always-on, per stem, non-fatal);
// the clip header's "transcribe this loop" seam skips separation entirely and
// sends one sliced WAV down the exact same chain. Keeping them together is what
// stops a second, subtly different transcription path from appearing.
//
// Both land their notes through `sessionHost.addNoteLane(..., { newScene: true })`
// and both are responsible for scoping the scene they land in — the dialog resets
// it once per batch, the loop seam once per loop. That shared convention is the
// other reason they are one module.
//
// ORDER: the factory installs `sessionHost.setTranscribeLoop` as its last
// statement, so the call site in boot is where that seam becomes live. It sits
// between the two halves of the save/history region in main.ts and must stay
// there — the session inspector picks the callback up when it is next rendered,
// not at construction, so this is a "run it at this point" statement like the
// ones around it.

import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import type { SessionClip } from '../session/session';
import { StemClient } from '../stems/stem-client';
import { stemServiceBaseUrl } from '../stems/stem-config';
import { wireStemDialog } from '../stems/stem-dialog';
import { transcribeToNoteLane } from '../stems/transcribe-to-clip';
import { sampleCache } from '../samples/sample-cache';
import { clipLoopSourceRange } from '../core/clip-loop';
import { sliceBufferToWavFile } from '../samples/buffer-to-wav';

export interface StemsFeatureDeps {
  /** Handed to the dialog for audition playback of a separated stem. */
  ctx: AudioContext;
  /** Read at transcription time for the tempo + meter the notes are quantised to. */
  seq: Sequencer;
  /** The lanes land here: addStemLanes / addNoteLane / resetTranscriptionScene,
   *  plus setTranscribeLoop, the seam the clip header calls. */
  sessionHost: SessionHost;
  /** The canonical BPM setter — conforming the project tempo to the imported
   *  audio has to reach the scheduler, the UI and the tempo-locked engines. */
  setTransportBpm: (bpm: number) => void;
}

export interface StemsFeature {
  /** The Stems modal handle; the transport button and the Tools menu both open it. */
  stemDialog: { open: () => void };
}

export function createStemsFeature(deps: StemsFeatureDeps): StemsFeature {
  const { ctx, seq, sessionHost, setTransportBpm } = deps;

  // Stems: transport-bar "Stems…" dialog → local separation service. Every
  // separation also transcribes each stem to a note/drums lane (always-on).
  const stemClient = new StemClient(stemServiceBaseUrl());
  const stemDialog = wireStemDialog({
    ctx,
    client: stemClient,
    addStemLanes: (stems, opts) => sessionHost.addStemLanes(stems, opts),
    // Conform the project tempo to the imported audio (detected from the drums
    // stem) via the canonical BPM setter — scheduler, UI and tempo-locked engines.
    setSessionBpm: setTransportBpm,
    getMeter: () => seq.meter,
    transcribeStem: async (file, label, kind) => {
      // Per-stem + non-fatal: a transcription failure for one stem must not abort
      // the others (the audio Sampler lanes are already created either way).
      try {
        const result = await stemClient.transcribe(file, kind);
        const plan = transcribeToNoteLane(result, seq.bpm, seq.meter);
        if (plan.notes.length) {
          // Land the transcribed lanes in their own scene, separate from the
          // audio stems (the batch's scene is reset once per separation).
          sessionHost.addNoteLane(plan.engineId, plan.notes, plan.lengthBars, label, { newScene: true });
        }
      } catch (err) {
        console.warn('[stems] transcription failed for', label, err);
      }
    },
  });
  // Transcribe just the SELECTED LOOP of an audio clip → a fresh note/drums lane.
  // Slice the loop's SOURCE audio (warp-aware) to a WAV, then run it through the
  // same /transcribe chain the stems flow uses. Late-bound: it needs both the stem
  // client (above) and the session host (below) to exist.
  sessionHost.setTranscribeLoop(async (clip: SessionClip, kind: 'melodic' | 'drums') => {
    const s = clip.sample;
    if (!s) return;
    const buf = sampleCache.get(s.sampleId);
    if (!buf) return;
    const name = clip.name || 'Loop';
    try {
      const { startSec, endSec } = clipLoopSourceRange(clip, seq.meter, buf.duration);
      const wav = sliceBufferToWavFile(buf, startSec, endSec, `${name}.wav`);
      const result = await stemClient.transcribe(wav, kind);
      const plan = transcribeToNoteLane(result, seq.bpm, seq.meter);
      if (plan.notes.length) {
        sessionHost.resetTranscriptionScene();  // each loop transcription → its own scene
        sessionHost.addNoteLane(plan.engineId, plan.notes, plan.lengthBars, `${name} (notes)`, { newScene: true });
      }
    } catch (err) {
      console.warn('[transcribe-loop] failed for', name, err);
    }
  });

  return { stemDialog };
}
