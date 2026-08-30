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
import { landAutomationValue } from '../automation/automation-knob';
import type { ArrangementState } from '../performance/performance';
import { arrangementLoopWindowSec } from '../performance/arrangement-ops';
import {
  startArrangementAt, stopArrangement, tickArrangement, arrangementPlayhead,
  overrideLane, backToArrangement, isLaneOverridden, anchorLaneAt,
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
  /** The TIMELINE WINS door — the same contract the grid's onGridLaunch keeps:
   *  null claims every lane (begin, like a scene), a laneId claims that lane
   *  (each band launch). main wires it to weaveWiring.suspendForGrid, so a
   *  weaving/following lane hands over the moment the take drives it; the
   *  WEAVE panel takes it back with its own ▶, exactly as after a grid launch. */
  onTimelineLaunch?: (laneId: string | null) => void;
  /** Late-bound: automation-writes is built AFTER the performance feature, so
   *  main hands this in as a closure, never as a bare reference. Absent in test
   *  fixtures with no audio graph. */
  applyUnmounted?: (
    paramId: string, normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
  getTargetRanges?: () => ReadonlyMap<string, { min: number; max: number }>;
}

export interface ArrangementPlayback {
  /** Start playback at A (with an active A–B loop) or at the top. */
  begin(): void;
  /** One look-ahead frame. The caller ticks this ONLY in Performance mode. */
  tick(nowCtx: number, lookaheadSec: number): void;
  /** Ruler click: move the playhead (see seekTo's doc). */
  seekTo(sec: number): void;
  /** Launch-mute one lane: the arrangement stops driving it (launches AND
   *  automation), and what already sounds leaves at the next bar. */
  setLaunchMute(laneId: string, on: boolean): void;
  /** Launch-solo: every OTHER arrangement lane is launch-muted. null clears. */
  setLaunchSolo(laneId: string | null): void;
  /** What the lane headers paint. */
  getLaunchState(): { solo: string | null; muted: ReadonlySet<string> };
}

export function createArrangementPlayback(deps: ArrangementPlaybackDeps): ArrangementPlayback {
  const { ctx, seq, sessionHost, automationRegistry, arrangement, ps, recHooks } = deps;

  function onLaunchClip(laneId: string, clipId: string, atCtx: number, offsetSec = 0) {
    const lane = sessionHost.state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    // A re-laned band still references the clip of the lane it came from, so
    // the lookup falls back to EVERY lane's clips — the band says where it
    // PLAYS, the clip stays where it lives.
    let clip = lane.clips.find((c) => c?.id === clipId);
    if (!clip) {
      for (const l of sessionHost.state.lanes) {
        clip = l.clips.find((c) => c?.id === clipId);
        if (clip) break;
      }
    }
    if (!clip) return;
    // Timeline wins: claim the lane BEFORE the launch, so a weaving lane is
    // already suspended when its clip starts.
    deps.onTimelineLaunch?.(laneId);
    // Honour the arrangement's exact start time (startedAtCtx + atSec). Never
    // re-quantize to the session bar grid — that snapped the first event to the
    // next absolute bar boundary, leaving a silent first bar. Clamp to now so the
    // very first event (atSec 0, already a hair in the past once the tick fires)
    // schedules immediately rather than at a past time.
    //
    // The band's content offset is a PAST-SHIFTED anchor: subtracting it AFTER
    // the clamp makes the clip enter already `offsetSec` into itself — the same
    // mid-clip-entry machinery the A-loop seek exercises, so notes before the
    // offset are simply outside the look-ahead window and never fire.
    launchClipAtTime(sessionHost.laneStates, lane, clip, Math.max(atCtx, ctx.currentTime) - offsetSec);
  }

  function onStopLane(laneId: string) {
    stopLane(sessionHost.laneStates, laneId, {
      ...recHooks, nowCtx: ctx.currentTime, silence: sessionHost.deps.liveVoices,
    });
  }

  function applyAutomation(paramId: string, valueNorm: number) {
    // A take curve is a property of the take, not of what is on screen: when
    // the lane's editor is closed there is no knob, and the value must still
    // reach the audio object. It used to be dropped here.
    landAutomationValue(
      { registry: automationRegistry, applyUnmounted: deps.applyUnmounted, getTargetRanges: deps.getTargetRanges },
      paramId, valueNorm,
    );
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
      const scroller = document.querySelector('#performance-view-root .perf-scroller') as HTMLElement | null;
      const rulerTrack = scroller?.querySelector('.perf-ruler .perf-track') as HTMLElement | null;
      if (animating && scroller && rulerTrack) {
        const barSec = songBarSec(arrangement.bpm, seq.meter);
        const lw = arrangementLoopWindowSec(arrangement, seq.meter);
        let sec = arrangementPlayhead(ps, ctx.currentTime);
        if (lw.active) sec = lw.startSec + ((sec - lw.startSec) % (lw.endSec - lw.startSec));
        const bars = sec / barSec;
        // The playhead lives INSIDE the one scroll surface, so its coordinates
        // are content coordinates: the ruler track's offsetLeft (the sticky
        // label column) plus the bar position. No scroll compensation — the
        // cursor scrolls with the music. Height spans the full content, not
        // just the visible box.
        el.style.left = `${rulerTrack.offsetLeft + bars * deps.getPxPerBar()}px`;
        el.style.height = `${scroller.scrollHeight}px`;
        el.style.display = 'block'; // '' would fall back to the CSS display:none
      } else {
        el.style.display = 'none';
      }
    }
    playheadRaf = animating ? requestAnimationFrame(rafPlayhead) : 0;
  }

  /** Ruler click: move the playhead. Playing → stop everything and re-anchor
   *  at the clicked second (the same relaunch a loop wrap uses, so the bands
   *  under the new position sound at once). Stopped → move the shared song
   *  anchor so the next Play and the Session view agree on the position. */
  function seekTo(sec: number) {
    const at = Math.max(0, sec);
    if (ps.isPlaying) {
      stopAll(sessionHost.laneStates, sessionHost.deps.liveVoices, ctx.currentTime);
      startArrangementAt(ps, ctx.currentTime, arrangement, at, onLaunchClip);
    } else {
      sessionHost.setSongAnchor(ctx.currentTime - at);
    }
  }

  // ---- Launch-solo / launch-mute -------------------------------------------
  // The gate is the dormant per-lane override in the runtime: an overridden lane
  // receives no launches and no automation from the take. Sounding audio leaves
  // musically — a bar-quantized stop through the SAME queuedStop door a scene
  // launch uses — and a freed lane is re-anchored into the band under the
  // playhead, exactly the way a seek relaunches.
  const launchMuted = new Set<string>();
  let launchSolo: string | null = null;

  function overrideTargets(): Set<string> {
    const t = new Set(launchMuted);
    if (launchSolo !== null) {
      for (const l of arrangement.lanes) if (l.laneId !== launchSolo) t.add(l.laneId);
    }
    return t;
  }

  function applyLaunchGate() {
    const targets = overrideTargets();
    const barSec = songBarSec(arrangement.bpm, seq.meter);
    const tNow = arrangementPlayhead(ps, ctx.currentTime);
    const stopAtCtx = ps.startedAtCtx + Math.ceil(tNow / barSec) * barSec;
    for (const laneId of targets) {
      if (isLaneOverridden(ps, laneId)) continue;
      overrideLane(ps, laneId);
      if (!ps.isPlaying) continue;
      const lp = sessionHost.laneStates.get(laneId);
      if (lp) { lp.queued = null; lp.queuedStop = stopAtCtx; }
    }
    for (const laneId of [...ps.laneOverridden.keys()]) {
      if (targets.has(laneId)) continue;
      backToArrangement(ps, laneId);
      const lp = sessionHost.laneStates.get(laneId);
      if (lp) lp.queuedStop = null;
      if (!ps.isPlaying) continue;
      const lane = arrangement.lanes.find((l) => l.laneId === laneId);
      if (lane) anchorLaneAt(ps, lane, tNow, ctx.currentTime, onLaunchClip);
    }
  }

  function setLaunchMute(laneId: string, on: boolean) {
    if (on) launchMuted.add(laneId); else launchMuted.delete(laneId);
    applyLaunchGate();
  }

  function setLaunchSolo(laneId: string | null) {
    launchSolo = laneId;
    applyLaunchGate();
  }

  function getLaunchState() {
    return { solo: launchSolo, muted: new Set(launchMuted) };
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
    // Timeline wins: a take speaks for every lane, like a scene — claim them
    // all before the first launch.
    deps.onTimelineLaunch?.(null);
    const lw = arrangementLoopWindowSec(arrangement, seq.meter);
    const startSec = lw.active && lw.startSec > 0 ? lw.startSec : 0;
    startArrangementAt(ps, ctx.currentTime, arrangement, startSec, onLaunchClip);
    if (playheadRaf === 0) playheadRaf = requestAnimationFrame(rafPlayhead);
  }

  return { begin, tick, seekTo, setLaunchMute, setLaunchSolo, getLaunchState };
}
