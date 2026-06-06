// src/session/clip-editors/clip-waveform-header.ts
// The waveform strip shown ABOVE the normal clip editor (the visual the user
// liked). Two exports:
//   - mountWaveformHeader: canvas (waveform + bar/beat ruler + slice markers)
//     mounted above the body editor; returns { redraw } for the host RAF.
//   - renderAudioClipEditor: the audio-clip (Mode 1) editor — waveform header +
//     a small toolbar (warp). BPM/length live in the inspector, not here. No
//     note grid.

import type { SessionClip } from '../session';
import { sampleCache } from '../../samples/sample-cache';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';

const RULER_H = 18;
const WAVE_H = 64;

export interface WaveformHeaderHandle { redraw: () => void; }
export interface WaveformHeaderDeps { getPlayheadFrac?: () => number; }

/** Source buffer id used by the header: the audio clip's own sample, or a
 *  display-only waveformRef (Mode-2 sliced note clip). */
function headerSampleId(clip: SessionClip): string | undefined {
  return clip.sample?.sampleId ?? clip.waveformRef?.sampleId;
}

export function mountWaveformHeader(
  host: HTMLElement, clip: SessionClip, meter: TimeSignature = DEFAULT_METER, deps: WaveformHeaderDeps = {},
): WaveformHeaderHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'clip-waveform-header';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  host.appendChild(canvas);
  const c2d = canvas.getContext('2d');

  const barTicks = ticksPerBar(meter);
  const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
  const beatTicks = barTicks / beatsPerBar;
  const patternTicks = Math.max(1, clip.lengthBars * barTicks);
  let playheadFrac = -1;

  function draw(): void {
    if (!c2d) return;
    const w = Math.max(320, host.clientWidth || 600);
    const h = RULER_H + WAVE_H;
    canvas.width = w; canvas.height = h;
    canvas.style.height = `${h}px`;
    c2d.fillStyle = '#0c0c12'; c2d.fillRect(0, 0, w, h);

    // waveform
    const buf = headerSampleId(clip) ? sampleCache.get(headerSampleId(clip)!) : undefined;
    if (buf) {
      const data = buf.getChannelData(0);
      const mid = RULER_H + WAVE_H / 2;
      c2d.strokeStyle = '#4a6a8a'; c2d.beginPath();
      for (let px = 0; px < w; px++) {
        const i0 = Math.floor((px / w) * data.length);
        const i1 = Math.floor(((px + 1) / w) * data.length);
        let peak = 0; for (let i = i0; i < i1 && i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        c2d.moveTo(px, mid - peak * (WAVE_H / 2)); c2d.lineTo(px, mid + peak * (WAVE_H / 2));
      }
      c2d.stroke();
    }

    // bar/beat ruler
    for (let t = 0; t <= patternTicks; t += beatTicks) {
      const x = (t / patternTicks) * w;
      c2d.strokeStyle = (t % barTicks === 0) ? '#555' : '#2a2a2a';
      c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, RULER_H); c2d.stroke();
    }

    // slice markers (Mode-2 sliced clips carry the carve map on waveformRef)
    const slices = clip.waveformRef?.slices ?? [];
    const dur = buf?.duration ?? 0;
    if (slices.length && dur > 0) {
      c2d.strokeStyle = '#ffb454';
      for (const s of slices) {
        const x = (s.start / dur) * w;
        c2d.beginPath(); c2d.moveTo(x, RULER_H); c2d.lineTo(x, RULER_H + WAVE_H); c2d.stroke();
      }
    }

    // playhead
    if (playheadFrac >= 0) {
      const x = playheadFrac * w;
      c2d.strokeStyle = '#f7d000'; c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, h); c2d.stroke();
    }
  }

  draw();
  let lastW = Math.max(320, host.clientWidth || 600);
  return {
    redraw() {
      const f = deps.getPlayheadFrac?.() ?? -1;
      const w = Math.max(320, host.clientWidth || 600);
      if (f === playheadFrac && w === lastW) return; // nothing changed — skip repaint
      playheadFrac = f;
      lastW = w;
      draw();
    },
  };
}

export interface AudioClipEditorDeps {
  getPlayheadFrac?: () => number;
}

export function renderAudioClipEditor(
  host: HTMLElement, clip: SessionClip, meter: TimeSignature = DEFAULT_METER, deps: AudioClipEditorDeps = {},
): WaveformHeaderHandle {
  host.innerHTML = '';
  const sample = clip.sample;

  const toolbar = document.createElement('div');
  toolbar.className = 'audio-clip-toolbar';
  Object.assign(toolbar.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 2px', fontSize: '11px' } as Partial<CSSStyleDeclaration>);

  const warpBtn = document.createElement('button');
  warpBtn.className = 'audio-clip-warp';
  const refreshWarp = () => { warpBtn.textContent = sample?.warp ? '♺ Warp ON' : '♺ Warp OFF'; };
  warpBtn.addEventListener('click', () => { if (sample) { sample.warp = !sample.warp; refreshWarp(); } });
  refreshWarp();

  toolbar.append(warpBtn);
  host.appendChild(toolbar);

  const headerHost = document.createElement('div');
  host.appendChild(headerHost);
  return mountWaveformHeader(headerHost, clip, meter, { getPlayheadFrac: deps.getPlayheadFrac });
}
