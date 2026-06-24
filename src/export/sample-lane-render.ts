// src/export/sample-lane-render.ts
// Offline (OfflineAudioContext) synthesis for the NON-melodic lanes — drums,
// Sampler, and the Audio channel — through the SAME pure audio-dsp renderers the
// worklet uses. The melodic kernel render lives in kernel-lane-render.ts; this is
// its drum/sample counterpart so an offline scene export is no longer silent for
// those lanes (Phase 4 cutover regression fix).
//
// Pure: no Web Audio. The caller resolves spawns/hits (via the engine's
// resolveSpawn / per-voice bags) and plays the returned stereo buffer through the
// lane's ChannelStrip / inserts / master, preserving the full mix path.

import { DrumVoiceManager } from '../audio-dsp/drums/drum-voice-manager';
import { DRUM_VOICE_IDS, type DrumVoiceId, type DrumHit } from '../audio-dsp/drums/types';
import type { ParamBag } from '../audio-dsp/types';
import { SampleBank } from '../audio-dsp/sample/sample-bank';
import { SamplerRenderer } from '../audio-dsp/sample/sampler-renderer';
import { AudioClipRenderer } from '../audio-dsp/sample/audio-clip-renderer';
import type { SampleData, SampleSpawn } from '../audio-dsp/sample/types';

export interface StereoBuffer { l: Float32Array; r: Float32Array; }

/** One drum hit + the per-voice synth bag + per-voice mixer (level/pan) for the
 *  offline render. The live path applies level/pan on a per-voice ChannelStrip
 *  the offline kernel doesn't build, so we fold them in here. */
export interface OfflineDrumHit {
  voice: DrumVoiceId;
  beginSec: number;
  velocity: number;   // already accent-folded (0.65 · velGain) by the caller
}
export interface OfflineDrumVoiceMix { level: number; pan: number; }

/** Render a drums lane to stereo: each voice through DrumVoiceManager (choke
 *  groups + per-voice synth params), then summed at its per-voice level/pan into
 *  the L/R pair. Mirrors the live worklet drums + per-voice strip level/pan. */
export function renderDrumLane(
  hits: OfflineDrumHit[],
  voiceParams: Partial<Record<DrumVoiceId, ParamBag>>,
  voiceMix: Partial<Record<DrumVoiceId, OfflineDrumVoiceMix>>,
  frames: number,
  sampleRate: number,
): StereoBuffer {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  const mgr = new DrumVoiceManager(sampleRate);
  for (const v of DRUM_VOICE_IDS) mgr.setVoiceParams(v, voiceParams[v] ?? {});

  // Equal-power pan gains per voice (constant per lane render).
  const gainsL: Record<string, number> = {};
  const gainsR: Record<string, number> = {};
  for (const v of DRUM_VOICE_IDS) {
    const mix = voiceMix[v] ?? { level: 1, pan: 0 };
    const x = (mix.pan + 1) * 0.25 * Math.PI;
    gainsL[v] = mix.level * Math.cos(x);
    gainsR[v] = mix.level * Math.sin(x);
  }

  // Sort hits by time; spawn each at its begin frame, render block-by-block into
  // 8 per-voice scratch outputs, fold into L/R at the voice's level/pan.
  const pending = [...hits].sort((a, b) => a.beginSec - b.beginSec);
  let next = 0;
  const BLOCK = 128;
  const scratch: Float32Array[] = DRUM_VOICE_IDS.map(() => new Float32Array(BLOCK));
  for (let frame0 = 0; frame0 < frames; frame0 += BLOCK) {
    const n = Math.min(BLOCK, frames - frame0);
    // Spawn hits due within this block (at their exact begin frame).
    while (next < pending.length && Math.floor(pending[next].beginSec * sampleRate) < frame0 + n) {
      const h = pending[next++];
      const hit: DrumHit = { voice: h.voice, beginSec: h.beginSec, velocity: h.velocity };
      mgr.spawn(hit);
    }
    for (const s of scratch) s.fill(0, 0, n);
    const blockOut = scratch.map((s) => (s.length === n ? s : s.subarray(0, n)));
    mgr.renderInto(blockOut, frame0);
    for (let i = 0; i < DRUM_VOICE_IDS.length; i++) {
      const v = DRUM_VOICE_IDS[i];
      const gl = gainsL[v], gr = gainsR[v];
      const src = scratch[i];
      for (let j = 0; j < n; j++) { l[frame0 + j] += src[j] * gl; r[frame0 + j] += src[j] * gr; }
    }
  }
  return { l, r };
}

/** A resolved sample/audio spawn + the buffer to register under spawn.sampleId. */
export interface OfflineSampleSpawn {
  kind: 'sampler' | 'audio';
  spawn: SampleSpawn;
  /** Decoded channels (extracted from the AudioBuffer by the caller). */
  data: SampleData;
}

/** Render a Sampler / Audio lane to stereo: each spawn through SamplerRenderer
 *  (per-pad filter/amp/pan + stereo image) or AudioClipRenderer (flat stereo),
 *  summed into the L/R pair. The per-pad reverb/delay SENDS are dropped offline
 *  (no FxBus in the kernel) — same simplification as the melodic kernel render. */
export function renderSampleLane(
  spawns: OfflineSampleSpawn[],
  frames: number,
  sampleRate: number,
): StereoBuffer {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  const bank = new SampleBank();
  for (const s of spawns) if (!bank.has(s.spawn.sampleId)) bank.set(s.spawn.sampleId, s.data);

  interface Live { r: SamplerRenderer | AudioClipRenderer; }
  const live: Live[] = [];
  const pending = [...spawns].sort((a, b) => a.spawn.beginSec - b.spawn.beginSec);
  let next = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    while (next < pending.length && pending[next].spawn.beginSec <= t) {
      const s = pending[next++];
      live.push({ r: s.kind === 'audio'
        ? new AudioClipRenderer(s.spawn, bank, sampleRate)
        : new SamplerRenderer(s.spawn, bank, sampleRate) });
    }
    for (let k = live.length - 1; k >= 0; k--) {
      const { l: vl, r: vr } = live[k].r.renderStereoInto(t);
      l[i] += vl; r[i] += vr;
      if (live[k].r.done) live.splice(k, 1);
    }
  }
  return { l, r };
}
