// The always-visible transport row inputs: BPM spinner, swing slider, master
// volume, meter selector — plus the two programmatic seams that write to them.
//
// These four controls belong together because they are the same kind of thing:
// a raw <input>/<select> in the toolbar whose value IS a live transport setting.
// Each one clamps with the constant its subsystem clamps with (BPM_MIN/BPM_MAX,
// SWING_MAX), so the widget's range and the DSP's range cannot drift apart —
// that shared discipline is the cohesion here, and the reason the four handlers
// and their gesture brackets read as one block instead of four.
//
// The gesture brackets are part of the same concern: these are the only
// continuous inputs in boot that are NOT knobs, so they need their own
// pointerdown/focus → beginGesture, pointerup/blur → endGesture pairing to
// collapse a drag into one undo entry. The 'input' handlers keep driving live
// audio and must NOT open/close gestures themselves.
//
// TWO BOOT-TIME SIDE EFFECTS live in this factory body and fire at the call
// site's position, exactly where they used to: `bpmBroadcast.broadcast(seq.bpm)`
// is the initial tempo fan-out to every insert chain and engine, and
// `master.gain.value = parseFloat(volInput.value)` is the initial master gain
// read off the DOM. Both must land before any lane can sound, so the call site
// cannot drift later in boot.
//
// What stayed in main.ts: the meter <option> render + `meterSel.value` seed,
// because those run much earlier (right after `seq` exists) and pulling them
// down here would reorder them past laneHost and mixerDeps for nothing.
//
// `historyDeps` and `refreshPerformanceView` are handed in as thunks: both are
// built later in boot and both are only ever read at user-interaction time.

import type { Sequencer } from '../core/sequencer';
import type { HistoryDeps } from '../save/history-wiring';
import type { BpmBroadcaster } from './bpm-broadcast';
import { clampBpm, formatBpm, BPM_MIN, BPM_MAX } from '../core/bpm';
import { clampSwing, SWING_MAX } from '../core/swing';
import { meterFromLabel, stepsPerBar, formatMeter, type TimeSignature } from '../core/meter';

export interface TransportControlsDeps {
  seq: Sequencer;
  /** Live context — markTrackActive converts an audio time into a wall-clock delay. */
  ctx: AudioContext;
  /** Master gain node; the volume input writes straight into it. */
  master: GainNode;
  /** Every tempo change goes THROUGH this, never beside it. */
  bpmBroadcast: BpmBroadcaster;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  volInput: HTMLInputElement;
  meterSel: HTMLSelectElement;
  /** Late-bound: historyDeps is built near the end of boot, but the gesture
   *  brackets only read it when the user touches a control. */
  getHistoryDeps(): HistoryDeps | undefined;
  /** Late-bound call-site wrapper (main.ts's mutable `renderLanes`). */
  renderLanes(): void;
  /** Late-bound: performanceFeature is constructed further down in boot; the
   *  meter selector sits in the always-visible row so it can fire while the
   *  Performance view is on screen. */
  refreshPerformanceView(): void;
}

export interface TransportControls {
  /** Programmatic tempo set (MIDI import, demo load, stems, saves). */
  setTransportBpm(bpm: number): void;
  /** Apply a time signature from a demo or a save (scheduler + selector). */
  setTransportMeter(meter: TimeSignature): void;
  /** Records a track's "triggered" pulse timestamp for the track headers. */
  markTrackActive(trackId: string, audioTime: number): void;
}

export function createTransportControls(deps: TransportControlsDeps): TransportControls {
  const { seq, ctx, master, bpmBroadcast, bpmInput, swingInput, volInput, meterSel } = deps;

  // The spinner's range comes from the SAME constants clampBpm enforces. When the
  // markup carried its own min/max they were free to disagree with the clamp — and
  // did: the field stopped at 240 while nothing in the DSP cared.
  bpmInput.min = String(BPM_MIN);
  bpmInput.max = String(BPM_MAX);

  bpmInput.addEventListener('input', () => {
    const v = parseFloat(bpmInput.value);
    // Manual BPM edit = take constant-tempo control: drop any active song tempo map.
    if (!isNaN(v)) { seq.setTempoMap(undefined); bpmBroadcast.broadcast(clampBpm(v)); }
  });
  bpmBroadcast.broadcast(seq.bpm);

  // Programmatic tempo set (MIDI import, demo load): clamp, broadcast and reflect
  // it in the visible BPM input. Distinct from the 'input' handler above, which
  // must NOT write the input back while the user is mid-type.
  function setTransportBpm(bpm: number): void {
    // Keep the FLOAT — a detected 127.63 must not snap to 128, or native-played
    // audio (stems/loops) drifts against the grid within a few bars.
    const clamped = clampBpm(bpm);
    // Default to constant tempo; a MIDI import with tempo changes re-sets a map
    // immediately after (so demos/saves/stems, which don't, clear a stale map).
    seq.setTempoMap(undefined);
    bpmBroadcast.broadcast(clamped);
    bpmInput.value = formatBpm(clamped);
  }

  /** The canonical meter setter, the sibling of setTransportBpm. A demo or a
   *  save can carry a time signature, and it has to reach BOTH the scheduler
   *  (seq.meter, which is what maps a bar onto ticks) and the selector, or the
   *  UI claims 4/4 while the grid is in 3/4. Bar COUNT is preserved across the
   *  change, exactly as the selector's own handler does. */
  function setTransportMeter(meter: TimeSignature): void {
    const bars = Math.max(1, Math.round(seq.length / stepsPerBar(seq.meter)));
    seq.meter = meter;
    seq.setLength(bars * stepsPerBar(meter));
    meterSel.value = formatMeter(meter);
  }

  // Track activity timestamps for visual "triggered" pulse on track headers.
  const trackActiveUntil = new Map<string, number>();
  function markTrackActive(trackId: string, audioTime: number) {
    const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
    window.setTimeout(() => {
      trackActiveUntil.set(trackId, performance.now() + 120);
    }, delayMs);
  }

  // Like the BPM spinner: the slider's ceiling comes from the constant the
  // scheduler itself clamps to, so the two cannot drift apart.
  swingInput.max = String(SWING_MAX);
  swingInput.addEventListener('input', () => { seq.swing = clampSwing(parseFloat(swingInput.value)); });

  volInput.addEventListener('input', () => {
    master.gain.value = parseFloat(volInput.value);
    // Inverse sync (#volume → master strip fader): keep the fader visually in
    // step when the value changes here (drag, load, undo). Only assign .value —
    // never dispatch 'input' on the fader, or we'd loop back into this handler.
    const mf = document.querySelector('.master-strip .mix-fader') as HTMLInputElement | null;
    if (mf && mf.value !== volInput.value) mf.value = volInput.value;
  });
  master.gain.value = parseFloat(volInput.value);

  // ── Gesture brackets for continuous inputs (BPM / swing / volume) ──────────
  // One drag or keyboard-edit = one undo entry. pointerdown/focus opens the
  // gesture; pointerup/blur closes it. The existing 'input' handlers above keep
  // driving live audio and must NOT call beginGesture/commitGesture themselves.
  for (const el of [bpmInput, swingInput, volInput]) {
    el.addEventListener('pointerdown', () => {
      const h = deps.getHistoryDeps();
      if (h) h.beginGesture?.();
    });
    el.addEventListener('pointerup', () => {
      const h = deps.getHistoryDeps();
      if (h) h.endGesture?.();
    });
    el.addEventListener('focus', () => {
      const h = deps.getHistoryDeps();
      if (h) h.beginGesture?.();
    });
    el.addEventListener('blur', () => {
      const h = deps.getHistoryDeps();
      if (h) h.endGesture?.();
    });
  }

  meterSel.addEventListener('change', () => {
    // Keep the same number of bars across a meter change: derive the bar count
    // from the current length under the OLD meter, then re-length under the new
    // one. (The legacy "Bars" selector that used to drive this was removed.)
    const bars = Math.max(1, Math.round(seq.length / stepsPerBar(seq.meter)));
    seq.meter = meterFromLabel(meterSel.value);
    seq.setLength(bars * stepsPerBar(seq.meter));
    // The scheduler + transport read seq.meter / seq.length live on the next step.
    deps.renderLanes();
    // This selector sits in the always-visible transport row, so it can fire while
    // Performance is on screen. Nothing there caches the meter any more, but the
    // ruler/length field are only as fresh as their last paint — repaint them.
    // (Forward reference into a closure: main.ts hands this in as a thunk
    // because performanceFeature is constructed further down in boot — the same
    // trick bpmBroadcast's getters use.)
    deps.refreshPerformanceView();
  });

  return { setTransportBpm, setTransportMeter, markTrackActive };
}
