// Driving Performance playback: what the take does to the session while it
// plays, and where the cursor sits while it does. Lifted out of
// app/performance-feature.ts, which was 69 lines over the project's 500-line
// cap, as the one block there that is a closed loop — it reads the arrangement
// and writes the session + the cursor, and nothing else in the feature reads
// anything it produces.
//
// Deliberately NOT moved with it: the take's LIFECYCLE (arm/record/finalize,
// mode switching, undo, the view rebuild). Those interleave with the feature's
// own state on every line, and pulling them apart would have meant inventing a
// protocol rather than moving code.
//
// The mode gate stays with the caller: this module is asked to tick, it does not
// decide whether it should be. The RAF does need to know, because it parks
// itself when it should not be animating — hence `isPerformanceMode`.

import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import { driveKnobFromAutomation } from '../automation/automation-knob';
import type { ArrangementState } from '../performance/performance';
import { arrangementLoopWindowSec } from '../performance/arrangement-ops';
import {
  startArrangementAt, stopArrangement, tickArrangement, arrangementPlayhead,
  type ArrangementPlayState,
} from '../performance/arrangement-runtime';
import { launchClipAtTime, stopLane, stopAll, type RecHooks } from '../session/session-runtime';
import { songBarSec } from '../core/song-position';

export interface ArrangementPlaybackDeps {
  ctx: AudioContext;
  /** Read for `seq.meter` only — the song's meter owner. The arrangement holds
   *  no meter of its own, so every bar↔second conversion below asks for it. */
  seq: Sequencer;
  sessionHost: SessionHost;
  automationRegistry: Map<string, KnobHandle>;
  /** The live take. Held by reference: performance-feature's setArrangement
   *  does `Object.assign` into this same object, so a take loaded from a save
   *  lands here without re-wiring. */
  arrangement: ArrangementState;
  ps: ArrangementPlayState;
  recHooks: RecHooks;
  /** Current timeline zoom, read per frame — the user can drag it mid-play. */
  getPxPerBar: () => number;
  /** The RAF parks itself outside Performance mode; the caller owns the mode. */
  isPerformanceMode: () => boolean;
  /** Fired when playback runs off the end (song mode) so the host can reset its
   *  transport button. */
  onArrangementEnd?: () => void;
}

export interface ArrangementPlayback {
  /** Start playback at A (with an active A–B loop) or at the top. */
  begin(): void;
  /** One look-ahead frame. The caller ticks this ONLY in Performance mode. */
  tick(nowCtx: number, lookaheadSec: number): void;
}

export function createArrangementPlayback(deps: ArrangementPlaybackDeps): ArrangementPlayback {
  const { ctx, seq, sessionHost, automationRegistry, arrangement, ps, recHooks } = deps;

  function onLaunchClip(laneId: string, clipId: string, atCtx: number) {
    const lane = sessionHost.state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    const clip = lane.clips.find((c) => c?.id === clipId);
    if (!clip) return;
    // Honour the arrangement's exact start time (startedAtCtx + atSec). Never
    // re-quantize to the session bar grid — that snapped the first event to the
    // next absolute bar boundary, leaving a silent first bar. Clamp to now so the
    // very first event (atSec 0, already a hair in the past once the tick fires)
    // schedules immediately rather than at a past time.
    launchClipAtTime(sessionHost.laneStates, lane, clip, Math.max(atCtx, ctx.currentTime));
  }

  function onStopLane(laneId: string) {
    stopLane(sessionHost.laneStates, laneId, {
      ...recHooks, nowCtx: ctx.currentTime, silence: sessionHost.deps.liveVoices,
    });
  }

  function applyAutomation(paramId: string, valueNorm: number) {
    // Mounted-only, as before: a take curve whose knob is off screen stays
    // inert here. What changed is that landing it no longer writes the value
    // into the lane's base state — see automation-knob.ts.
    driveKnobFromAutomation(automationRegistry, paramId, valueNorm);
  }

  function tick(nowCtx: number, lookaheadSec: number) {
    // Global transport: while STOPPED, mirror a stopped-mode seek (which moved
    // the shared anchor via seekToBar) into the Arrangement clock so the perf
    // playhead follows it. Done BEFORE the tick (the tick is a no-op when stopped).
    if (!ps.isPlaying) ps.startedAtCtx = sessionHost.songAnchorSec;
    tickArrangement({
      ps, state: arrangement, nowCtx, lookaheadSec,
      bpm: arrangement.bpm,
      onLaunchClip,
      onStopLane,
      applyAutomation,
      loopWindow: arrangementLoopWindowSec(arrangement, seq.meter),
      onArrangementEnd: () => {
        stopAll(sessionHost.laneStates, sessionHost.deps.liveVoices, ctx.currentTime);
        stopArrangement(ps);
        deps.onArrangementEnd?.();
      },
    });
    // Global transport: after the tick, propagate the (possibly loop-wrapped)
    // Arrangement anchor BACK into the shared song anchor so the transport ruler
    // and a later view switch read the right position while Arrangement plays.
    if (ps.isPlaying) sessionHost.setSongAnchor(ps.startedAtCtx);
  }

  // The playhead RAF only runs while actually animating (Performance mode AND
  // playing). It used to re-queue itself unconditionally and never cancel, so it
  // did 3 DOM lookups + a style write every frame forever — even sitting idle in
  // Session mode. ensurePlayheadLoop() (re)starts it when playback begins; the
  // loop parks itself (one final pass to hide the cursor) when playback stops.
  let playheadRaf = 0;
  function rafPlayhead() {
    const animating = deps.isPerformanceMode() && ps.isPlaying;
    const el = document.getElementById('perf-playhead');
    if (el) {
      const host = document.getElementById('performance-view-root');
      const rulerTrack = host?.querySelector('.perf-ruler .perf-track') as HTMLElement | null;
      if (animating && host && rulerTrack) {
        const barSec = songBarSec(arrangement.bpm, seq.meter);
        const lw = arrangementLoopWindowSec(arrangement, seq.meter);
        let sec = arrangementPlayhead(ps, ctx.currentTime);
        if (lw.active) sec = lw.startSec + ((sec - lw.startSec) % (lw.endSec - lw.startSec));
        const bars = sec / barSec;
        // Position against the REAL ruler-track rect so the cursor lines up with
        // bar 1 regardless of the host padding, the label column, the toolbar
        // height or horizontal scroll. (The old hardcoded 90/26 offsets ignored
        // all of these → the cursor sat ~20px left of bar 1 and over the toolbar.)
        const hostRect = host.getBoundingClientRect();
        const trackRect = rulerTrack.getBoundingClientRect();
        el.style.left = `${(trackRect.left - hostRect.left) + bars * deps.getPxPerBar() - rulerTrack.scrollLeft}px`;
        el.style.top = `${trackRect.top - hostRect.top}px`;
        el.style.display = 'block'; // '' would fall back to the CSS display:none
      } else {
        el.style.display = 'none';
      }
    }
    playheadRaf = animating ? requestAnimationFrame(rafPlayhead) : 0;
  }

  function begin() {
    // With an active A-B loop, Play starts at A (the marked point); otherwise at
    // the top.
    //
    // This used to seek to `ctx.currentTime - sessionHost.songAnchorSec`, meaning
    // to resume the "shared song position" across a view switch. That position is
    // only meaningful WHILE the transport runs: songAnchorSec is the ctx time the
    // last playback began, and nothing rebases it on stop — so while stopped the
    // difference kept growing with wall-clock time. Play then seeked that far in:
    // pause 3s → start 3s late; pause longer than the arrangement → every lane's
    // cursor lands past its last event and NOTHING sounds at all. There was no
    // position to resume either way: arrangementPlayhead() returns 0 while
    // stopped and the cursor is hidden, so the "preserved position" was never
    // visible or reachable. Start from a real number instead of a stale clock.
    const lw = arrangementLoopWindowSec(arrangement, seq.meter);
    const startSec = lw.active && lw.startSec > 0 ? lw.startSec : 0;
    startArrangementAt(ps, ctx.currentTime, arrangement, startSec, onLaunchClip);
    if (playheadRaf === 0) playheadRaf = requestAnimationFrame(rafPlayhead);
  }

  return { begin, tick };
}
