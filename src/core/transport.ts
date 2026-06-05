import type { Sequencer } from './sequencer';

export interface TransportDeps {
  seq: Sequencer;
  ctx: AudioContext;
  playBtn: HTMLButtonElement;
  resetAutomationPosition: () => void;
  /** Unified stop: stops clock + lanes + finalizes any recording + resets UI.
   *  Stopping the master clock must also stop every lane and re-render the
   *  session, otherwise the per-lane play states keep `playing` set: the
   *  live-computed clip playheads (drum grid + piano roll) never return to -1
   *  so the cursors keep advancing, and the clip cells stay styled as playing. */
  onStop: () => void;
  /** Called just after the transport starts (Play) — begins an armed live-take. */
  onStart?: () => void;
}

/** Wires the Play/Stop button. (The Classic A/B/C/D pattern bank, chain, and
 *  loop transport are gone — the Session owns per-lane playback.) */
export function wireTransport(deps: TransportDeps): () => void {
  const { seq, ctx, playBtn } = deps;
  const ac = new AbortController();
  const { signal } = ac;

  playBtn.addEventListener('click', () => {
    void ctx.resume();
    if (seq.isPlaying()) {
      deps.onStop();
    } else {
      deps.resetAutomationPosition();
      seq.start();
      playBtn.textContent = '■';
      deps.onStart?.();
    }
  }, { signal });

  return () => { ac.abort(); };
}
