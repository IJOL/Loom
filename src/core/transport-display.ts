// Transport position display.
//
// Renders two readouts in the transport row:
//   - BAR.BEAT.STEP    — 1-indexed song position derived from elapsed time
//                        and current BPM (16 sixteenth-steps per bar, 4 beats
//                        per bar). Session mode doesn't advance a single
//                        sequencer cursor (each lane has its own clock) so
//                        we compute the global position from elapsed seconds.
//   - hh:mm:ss elapsed — wall-clock since the most recent seq.start().
//
// Updates via requestAnimationFrame while playing; freezes on stop. The
// elapsed clock zeroes on start (matches what users expect from a DAW
// transport indicator).

import type { Sequencer } from './sequencer';
import { stepsPerBar, stepsPerBeat } from './meter';
import { TICKS_PER_STEP } from './notes';
import { tickToSec, secToTick, bpmAtTick } from './tempo-map';

export interface TransportDisplayDeps {
  seq: Sequencer;
  ctx: AudioContext;
  positionEl: HTMLElement;
  timeEl: HTMLElement;
  /** The visible BPM input. When a tempo map is active, the readout shows the
   *  live current tempo here while playing. Optional. */
  bpmEl?: HTMLInputElement;
}

export function formatPosition(step: number, barSteps: number, beatSteps: number): string {
  const bar = Math.floor(step / barSteps) + 1;
  const beat = Math.floor((step % barSteps) / beatSteps) + 1;
  const sub = Math.floor(step % beatSteps) + 1;
  return `${bar}.${beat}.${sub}`;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function wireTransportDisplay(deps: TransportDisplayDeps): void {
  const { seq, ctx, positionEl, timeEl, bpmEl } = deps;
  let playStartCtxTime: number | null = null;
  let wasPlaying = false;

  function tick() {
    const playing = seq.isPlaying();
    if (playing) {
      if (!wasPlaying) {
        playStartCtxTime = ctx.currentTime;
        wasPlaying = true;
      }
      const elapsed = ctx.currentTime - (playStartCtxTime ?? ctx.currentTime);
      const m = seq.meter;
      const tmap = seq.tempoMap;
      if (tmap && seq.tempoSongTicks > 0) {
        // Tempo-map playback: position + BPM follow the map, not a constant bpm.
        // Loop the readout over the song length so it tracks the looping clips.
        const songDur = tickToSec(tmap, seq.tempoSongTicks);
        const posSec = songDur > 0 ? elapsed % songDur : elapsed;
        const tk = secToTick(tmap, posSec);
        positionEl.textContent = formatPosition(tk / TICKS_PER_STEP, stepsPerBar(m), stepsPerBeat(m));
        if (bpmEl) bpmEl.value = String(Math.round(bpmAtTick(tmap, tk)));
      } else {
        // step = elapsed / step_duration (60/bpm/4 = 16ths) → elapsed * bpm * 4 / 60.
        positionEl.textContent = formatPosition(elapsed * seq.bpm * 4 / 60, stepsPerBar(m), stepsPerBeat(m));
      }
      timeEl.textContent = formatElapsed(elapsed);
    } else if (wasPlaying) {
      // Just stopped — freeze the readout so the user can read the final position.
      wasPlaying = false;
      playStartCtxTime = null;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
