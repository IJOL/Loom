// Where a session comes FROM — the three routes that replace the whole
// SessionState wholesale, plus the list two of them share.
//
// The cohesion is the replacement itself. The boot demo fetches a JSON asset and
// applies it; the toolbar demo picker applies another one on demand; New wipes to
// an empty state. All three end in `sessionHost.applyLoadedSessionState(...)`
// followed by the same tail — conform the tempo, then mark the undo stack clean —
// and all three therefore share the same hazards. Keeping them in one file is
// what stops a fourth, subtly different "load a session" path from appearing.
//
// GATING, and it travels with the code rather than being re-derived around it:
// applying a session allocates a subtractive lane synchronously, and that lane's
// WorkletLaneEngine constructs an `AudioWorkletNode` — which throws if the
// processor's addModule has not resolved yet. So the boot demo waits on
// `Promise.all([presetsLoaded, workletReady])` and the picker is only wired
// behind `workletReady`. Neither gate is optional and neither may be widened.
//
// `markClean` is a thunk, not a value: in boot this module is called BEFORE
// AutoHistory exists (it is built from the save/history region further down), and
// every caller of markClean here runs inside a later async continuation or a
// click handler. Reading it at use time is exactly the shape main.ts had.
//
// NOT here, deliberately: the `onStateApplied` registrations that mount the boot
// -eager drum/poly knob panels. They must be registered BEFORE the demo load so
// they fire on the FIRST apply, so they stay above this factory's call site in
// main.ts — moving them in would say nothing about their order and moving them
// after would silently empty those panels on a fresh boot.

import type { SessionHost } from '../session/session-host';
import type { PerformanceFeature } from './performance-feature';
import type { DemoItem } from './menu-actions';
import { emptySessionState } from '../session/session';
import { fetchDemoSession } from '../demo/demo-loader';
import { wireDemoPicker } from '../demo/demo-picker';
import { confirmDialog } from '../core/dialog';

export interface SessionLifecycleDeps {
  /** Every route in this file ends in `applyLoadedSessionState`. */
  sessionHost: SessionHost;
  /** Resolves when the engine preset cache is populated — the boot demo's apply
   *  reads each lane's `enginePresetName`, so it must not run before this. */
  presetsLoaded: Promise<unknown>;
  /** Resolves when the AudioWorklet processors are registered. BOTH async paths
   *  here are gated on it: applying a session allocates a subtractive lane whose
   *  `new AudioWorkletNode` throws before addModule resolves. */
  workletReady: Promise<void>;
  /** The canonical BPM setter — a demo's optional tempo has to reach the
   *  scheduler, the BPM input, every insert chain and every tempo-locked engine. */
  setTransportBpm(bpm: number): void;
  /** Late-bound on purpose: AutoHistory is built AFTER this factory runs in boot,
   *  so the undo stack can only be resolved at call time. */
  markClean(): void;
  /** New also wipes the Performance take (`resetArrangement`). Held BY VALUE —
   *  it is built earlier in boot and TypeScript rejects the call if that is ever
   *  reversed. */
  performanceFeature: PerformanceFeature;
  /** Stops the clock AND silences every lane. New calls it before wiping. */
  stopTransport(): void;
  /** Wipe the weave back to nothing. New has to say this out loud: the weave
   *  lives beside the session rather than inside it, so `replaceSession` alone
   *  left the macros, the flow and every dead lane's selection alive in a
   *  session that no longer had those lanes. Absent in fixtures with no panel. */
  resetWeave?(): void;
}

export interface SessionLifecycle {
  /** The one demo list. The toolbar picker is wired with it here; the File >
   *  Open Demo menu reads the same array through `menuActions.listDemos`. */
  demos: DemoItem[];
  /** Wipe to a fresh empty session. The toolbar button is bound to it here and
   *  the menu bar calls this same function — never a synthetic click. */
  newSession(): Promise<void>;
}

export function wireSessionLifecycle(deps: SessionLifecycleDeps): SessionLifecycle {
  const {
    sessionHost, presetsLoaded, workletReady, setTransportBpm,
    markClean, performanceFeature, stopTransport,
  } = deps;

  // Boot demo: fetched as a static JSON asset rather than constructed
  // programmatically. The JSON drives the SessionState; applyLoadedSessionState
  // reads each lane.enginePresetName to set that channel's sound.
  //
  // We gate the demo apply on `presetsLoaded` so the engine preset cache is
  // populated before applyLoadedSessionState calls applyPresetByName.
  // Gate the demo apply on BOTH the preset cache AND the worklet module: the demo
  // allocates a subtractive lane (LANE_ID_POLY) whose WorkletLaneEngine needs the
  // processor registered before it constructs its AudioWorkletNode.
  Promise.all([presetsLoaded, workletReady])
    .then(() => fetchDemoSession(`${import.meta.env.BASE_URL}demos/minimal-techno.json`))
    .then((state) => {
      sessionHost.replaceSession(state);
      if (typeof state.bpm === 'number') setTransportBpm(state.bpm);
      markClean();
    })
    .catch((err: unknown) => {
      console.error('Demo load failed; falling back to empty session.', err);
    });

  // Demo picker: just the hand-built Minimal Techno showcase (also the boot
  // default). MIDI content is loaded live via the transport MIDI Import — there
  // are no pre-baked MIDI demos.
  // Lifted to a module-level const so BOTH the toolbar picker and the File >
  // Open Demo menu (menuActions.listDemos, below) share the SAME list.
  const DEMOS = [
    { label: 'Minimal Techno', path: `${import.meta.env.BASE_URL}demos/minimal-techno.json` },
    { label: 'Acid Rain', path: `${import.meta.env.BASE_URL}demos/acid-rain.json` },
    { label: 'Cordillera', path: `${import.meta.env.BASE_URL}demos/cordillera.json` },
    { label: 'Neon Drive', path: `${import.meta.env.BASE_URL}demos/neon-drive.json` },
  ];
  const demoPicker = document.getElementById('demo-picker') as HTMLSelectElement | null;
  if (demoPicker) {
    // Wire the picker only after the worklet module is registered: picking a demo
    // runs applyLoadedSessionState synchronously, which allocates a subtractive
    // WorkletLaneEngine (→ new AudioWorkletNode). Doing so before addModule
    // resolves would throw. On a normal load this resolves in ms.
    void workletReady.then(() => {
      wireDemoPicker({
        sessionHost,
        selectEl: demoPicker,
        demos: DEMOS,
        applyBpm: setTransportBpm,
        onLoaded: () => markClean(),
      });
    });
  }

  // New: wipe to a fresh empty session (default 303/drums/sub lanes, no clips).
  // Named + exported-shape function so the menu bar can call the SAME function
  // the toolbar button calls (no synthetic clicks).
  async function newSession(): Promise<void> {
    if (!await confirmDialog('Start a new empty session? Unsaved changes will be lost.')) return;
    // Stop the transport + silence every lane's voices BEFORE wiping. Without this
    // the master clock keeps running and in-flight voices keep sounding after the
    // old lanes are disposed → the "New leaves the old synths playing" bug.
    stopTransport();
    // replaceSession, not applyLoadedSessionState: New releases EVERY live
    // resource first (lane strips + engines, note-FX, master/send racks, the
    // master processors, mute/solo, knob handles). Without that, everything the
    // empty state does not mention — the whole mixer, chiefly the sends — rode
    // through untouched, and so did every later demo load.
    sessionHost.replaceSession(emptySessionState());
    // Also wipe the Performance take + leave Performance mode. Without this New
    // cleared the session but left the old arrangement in the timeline, where
    // every band turned into an orphaned "missing" (clipEvents pointing at the
    // just-deleted clips).
    performanceFeature.resetArrangement();
    // And the weave, which is neither in the session state nor in the
    // arrangement. Without this, New kept the previous scene's macros, its
    // master flow and its speed — a "new" session that was already travelling.
    deps.resetWeave?.();
    markClean();
  }
  document.getElementById('new-session')?.addEventListener('click', () => { void newSession(); });

  return { demos: DEMOS, newSession };
}
