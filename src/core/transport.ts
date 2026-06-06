import type { Sequencer } from './sequencer';

export interface TransportDeps {
  seq: Sequencer;
  ctx: AudioContext;
  playBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
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

/** Reflect "transport is running" on the Play button via a CSS class. Play and
 *  Stop are now separate buttons, so the button glyph stays ▶ — the `is-playing`
 *  class is what lights it up while running (see _transport styles). */
export function setPlaying(playBtn: HTMLButtonElement, on: boolean): void {
  playBtn.classList.toggle('is-playing', on);
}

/** Wires the separate Play and Stop buttons. Play only ever STARTS the
 *  transport (no-op while already running); Stop only ever STOPS it (no-op when
 *  idle). The Classic pattern bank / chain / loop transport are gone — the
 *  Session owns per-lane playback. */
export function wireTransport(deps: TransportDeps): () => void {
  const { seq, ctx, playBtn, stopBtn } = deps;
  const ac = new AbortController();
  const { signal } = ac;

  playBtn.addEventListener('click', () => {
    void ctx.resume();
    if (seq.isPlaying()) return;               // Play never stops
    deps.resetAutomationPosition();
    seq.start();
    setPlaying(playBtn, true);
    deps.onStart?.();
  }, { signal });

  stopBtn.addEventListener('click', () => {
    if (!seq.isPlaying()) return;              // Stop never starts
    deps.onStop();
  }, { signal });

  return () => { ac.abort(); };
}
