import type { Sequencer } from './sequencer';

export interface TransportDeps {
  seq: Sequencer;
  ctx: AudioContext;
  playBtn: HTMLButtonElement;
  resetAutomationPosition: () => void;
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
      playBtn.textContent = '▶';
    } else {
      deps.resetAutomationPosition();
      seq.start();
      playBtn.textContent = '■';
    }
  }, { signal });

  return () => { ac.abort(); };
}
