// Scene export (real-time live-take + offline WAV) — the REC button and the
// three ways a take leaves Loom. One REC button (#rec) + a 3-mode selector
// (🎛 take / ⏱ live / ⚡ offline). All three deliver via deliverTake; the old
// separate #export-scene control + its rt/offline menu are folded in here.
//
// This is a closed loop: the mode state, the button painting, the transient
// message timer, the LiveTakeRecorder, the offline scene render and the shared
// take-destination hand-off all read and write each other and nothing else in
// boot reads anything they produce. Only two seams point outward, and both are
// on the returned handle: `refreshRecButton` (the Performance feature repaints
// the shared button when its own arm state changes) and `stopTransport`.
//
// stopTransport lives here because the unified stop has to finalize an
// in-flight take BEFORE it stops the clock — that ordering is the whole point
// of the seam, and it only makes sense next to the recorder it finalizes. Its
// four callers in main.ts (the SessionHost "⏹ all" button, wireTransport's Stop,
// the MIDI import's resetSession and the New-session wipe) all reach it through
// a one-line delegator there, so none of them had to learn a new name.
//
// The #rec element is looked up here rather than handed in: main.ts's only use
// of it was to pass it down to this code.

import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import type { LiveVoiceRegistry } from './live-voice-registry';
import type { PerformanceFeature } from './performance-feature';
import type { RenderedAudio } from '../export/types';
import { setPlaying } from '../core/transport';
import { stopAll as stopAllLanes } from '../session/session-runtime';
import { LiveTakeRecorder } from '../export/live-take';
import { OfflineSceneRecorder } from '../export/offline-recorder';
import { soundingSceneDurationSec } from '../export/scene-duration';
import { wavEncoder } from '../export/wav-encoder';
import { downloadBlob, exportTimestamp } from '../export/download';
import { showTakeDestinationDialog } from '../export/take-destination-dialog';

export interface RecordingFeatureDeps {
  ctx: AudioContext;
  seq: Sequencer;
  /** The transport's Play button — reset by the unified stop, disabled while an
   *  offline render runs (it would race the live graph). */
  playBtn: HTMLButtonElement;
  sessionHost: SessionHost;
  /** Passed to stopAll so a long 'audio' channel clip is cut on Stop instead of
   *  playing its buffer out (it has no gate to self-terminate on). */
  liveVoices: LiveVoiceRegistry;
  /** Node carrying the full master signal — audio-graph's `masterComp.output`. */
  tap: AudioNode;
  /** Held by value, NOT behind a getter: createPerformanceFeature runs earlier in
   *  boot than this factory, so the reference is already final and TypeScript
   *  would reject the call outright if that order were ever reversed. The LATE
   *  direction is the other one — the feature's onRecVisualChanged has to reach
   *  refreshRecButton, which does not exist until this factory returns, so main
   *  hands it `() => recording.refreshRecButton()` and never the bare value. */
  performanceFeature: PerformanceFeature;
}

export interface RecordingFeature {
  /** Repaint the shared REC button from the active mode + its recorder state.
   *  Called by the Performance feature whenever its take arm flips. */
  refreshRecButton(): void;
  /** The unified stop: finalize any in-flight take, then stop the clock and
   *  every lane. Every Stop path in the app funnels through this. */
  stopTransport(): void;
}

export function createRecordingFeature(deps: RecordingFeatureDeps): RecordingFeature {
  const { ctx, seq, playBtn, sessionHost, liveVoices, tap, performanceFeature } = deps;

  // ── REC button (arms knob → lane recording) ───────────────────────────────
  const recBtn = document.getElementById('rec') as HTMLButtonElement;

  const EXPORT_TAIL_SEC = 2;    // live take: let reverb/delay tails decay before the cut
  type RecMode = 'take' | 'live' | 'offline';
  let recMode: RecMode = 'take';
  let liveState: 'idle' | 'armed' | 'recording' = 'idle';
  let exportMsgTimer: number | undefined;

  // Paint the shared REC button from the active mode + its recorder state.
  function refreshRecButton(): void {
    if (exportMsgTimer !== undefined) return; // a transient message owns the label
    recBtn.classList.remove('armed', 'recording');
    if (recMode === 'live') {
      recBtn.classList.toggle('armed', liveState === 'armed');
      recBtn.classList.toggle('recording', liveState === 'recording');
      recBtn.textContent = liveState === 'armed' ? '● ARMED' : liveState === 'recording' ? '● Recording…' : '● REC';
    } else if (recMode === 'take') {
      recBtn.classList.toggle('armed', performanceFeature.rec.armed);
      recBtn.textContent = performanceFeature.rec.armed ? '● REC ON' : '● REC';
    } else {
      recBtn.textContent = '● REC';
    }
  }

  function showExportMessage(msg: string): void {
    if (exportMsgTimer !== undefined) clearTimeout(exportMsgTimer);
    recBtn.textContent = msg;
    exportMsgTimer = window.setTimeout(() => { exportMsgTimer = undefined; refreshRecButton(); }, 1500);
  }

  // Real-time take: ARM → Play → Stop. Arming pre-connects the master tap; Play
  // starts the capture; the unified stop finalizes it (delivered via deliverTake).
  const liveTake = new LiveTakeRecorder({
    ctx,
    tap,
    tailSec: EXPORT_TAIL_SEC,
    onState: (s) => { liveState = s; refreshRecButton(); },
    onTake: (audio) => deliverTake(audio),
    onError: (m) => { console.warn('[live-take]', m); showExportMessage(m); },
  });

  // Unified stop: finalize any in-progress take (delivers via onTake), then stop
  // the master clock + every lane and reset the Play button + re-render. Clearing
  // each lane's `playing` clip returns the editor playheads to -1 (cursors
  // disappear) and re-renders the clip cells as stopped. Matches "⏹ all".
  function stopTransport(): void {
    liveTake.finish();
    if (seq.isPlaying()) seq.stop();
    // Pass the live-voice silencer so a long 'audio' channel clip is cut now,
    // not when its buffer ends (it has no gate to self-terminate on Stop).
    stopAllLanes(sessionHost.laneStates, liveVoices, ctx.currentTime);
    setPlaying(playBtn, false);
    sessionHost.renderWithMixer();
  }

  // Begin capturing an armed live-take whenever the transport starts — from ANY
  // path. Wiring this to the ▶ button alone missed scene/clip launches (the most
  // natural way to start playback), so the armed take never recorded. Centralized
  // on the Sequencer's idle→playing transition; onTransportStart() is a no-op
  // unless a take is armed, so this is safe on every start.
  // Chain, don't overwrite: SessionHost.init() already installed an onStart that
  // resets the global song anchor; preserve it so the playhead anchors at the
  // downbeat. (seq.onStart is a single slot — a plain assign would drop the reset.)
  //
  // ORDER, the one thing the extraction genuinely moved: in boot glue this chain
  // used to be installed AFTER wireTransport and createPerfDiagnostics; folding it
  // into this factory runs it BEFORE them. That is safe, and here is the proof, so
  // the next person to move this block does not have to re-derive it: seq.onStart
  // has exactly three producers in src/ — the Sequencer's own slot, SessionHost's
  // anchor reset (installed by init(), which still runs first), and this line.
  // wireTransport has its own unrelated `deps.onStart` field that main never sets,
  // and perf-diagnostics only forwards `deps.seq`. Neither reads or writes this
  // slot, so the chain still sits on top of SessionHost's reset, in that order.
  // Get this wrong and an armed live take silently records nothing — and no test
  // covers it, so the compiler and the suite would both stay quiet.
  const prevOnStart = seq.onStart;
  seq.onStart = () => { prevOnStart?.(); liveTake.onTransportStart(); };

  // Shared delivery for a finished take/render (live OR offline): ask where it
  // goes (download a WAV vs a new audio channel) — never auto-insert. The channel
  // branch passes the project BPM so the clip locks to the grid (warp 1.0) instead
  // of re-detecting the tempo of audio we just rendered.
  function deliverTake(audio: RenderedAudio): void {
    void (async () => {
      const dest = await showTakeDestinationDialog();
      if (!dest) { showExportMessage('Take discarded'); return; }
      const blob = wavEncoder.encode(audio.channels, audio.sampleRate);
      if (dest === 'file') {
        downloadBlob(blob, `loom-take-${exportTimestamp()}.${wavEncoder.extension}`);
        showExportMessage('Take → WAV file');
      } else {
        const file = new File([blob], `loom-take-${exportTimestamp()}.wav`, { type: 'audio/wav' });
        sessionHost.addAudioChannel(file, { knownBpm: seq.bpm });
        showExportMessage('Take → audio channel');
      }
    })();
  }

  function runOfflineExport(): void {
    // Render EXACTLY the musical (bar-aligned) length — no reverb tail. At the
    // project BPM that makes the warp ratio 1.0 and the loop seamless, so the
    // result locks to the grid. (A trailing tail rounds up to an extra bar and
    // drifts — the offline "no sincroniza" bug.) Then route through the dialog.
    const musicSec = soundingSceneDurationSec(sessionHost.laneStates, seq.meter, seq.bpm);
    if (musicSec <= 0) { showExportMessage('Launch a scene first'); return; }
    if (exportMsgTimer !== undefined) { clearTimeout(exportMsgTimer); exportMsgTimer = undefined; }
    recBtn.disabled = true; playBtn.disabled = true;
    recBtn.textContent = 'Rendering…';
    void (async () => {
      try {
        const rendered = await new OfflineSceneRecorder({
          state: sessionHost.state,
          laneStates: sessionHost.laneStates,
          bpm: seq.bpm,
          meter: seq.meter,
          swing: seq.swing,
        }).record(musicSec);
        deliverTake(rendered);
      } catch (err) {
        showExportMessage('Export failed: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        recBtn.disabled = false; playBtn.disabled = false;
        if (exportMsgTimer === undefined) refreshRecButton();
      }
    })();
  }

  // 3-mode selector (🎛 take / ⏱ live / ⚡ offline) — mutually exclusive: switching
  // disarms whatever the leaving mode had armed.
  const recModeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-recmode]'));
  function setRecMode(m: RecMode): void {
    if (m === recMode) return;
    if (recMode === 'take' && performanceFeature.rec.armed) performanceFeature.toggleTakeRec();
    if (recMode === 'live' && liveState === 'armed') void liveTake.toggleArm();
    recMode = m;
    for (const b of recModeBtns) b.classList.toggle('on', b.dataset.recmode === m);
    refreshRecButton();
  }
  for (const b of recModeBtns) b.addEventListener('click', () => setRecMode(b.dataset.recmode as RecMode));

  // The single REC button dispatches by the active mode.
  recBtn.addEventListener('click', () => {
    void ctx.resume();
    if (recMode === 'take') { performanceFeature.toggleTakeRec(); refreshRecButton(); }
    else if (recMode === 'live') { void liveTake.toggleArm(); }
    else runOfflineExport();
  });
  refreshRecButton();

  return { refreshRecButton, stopTransport };
}
