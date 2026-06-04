import type { Sequencer } from './sequencer';

export interface TransportDeps {
  seq: Sequencer;
  ctx: AudioContext;
  playBtn: HTMLButtonElement;
  resetAutomationPosition: () => void;
  /** Stopping the master clock must also stop every lane and re-render the
   *  session, otherwise the per-lane play states keep `playing` set: the
   *  live-computed clip playheads (drum grid + piano roll) never return to -1
   *  so the cursors keep advancing, and the clip cells stay styled as playing. */
  onStop?: () => void;
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
      seq.stop();
      deps.onStop?.();
      playBtn.textContent = '▶';
    } else {
      deps.resetAutomationPosition();
      seq.start();
      playBtn.textContent = '■';
    }
  }, { signal });

  return () => { ac.abort(); };
}
