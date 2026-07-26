// Live MIDI control subsystem — the whole surface, end to end.
//
// Assemble facade → mediator → access seam → UI: the LoomControlFacade every
// live input funnels through, the 1-bar count-in, the Web-MIDI access seam with
// its enable/disable + profile persistence, the computer keyboard as a
// MIDI-style live input, the transport hotkeys, the toolbar status chips, the
// clip-header Rec binding, the LED refresh hung off renderWithMixer, the unload
// cleanup and the auto-reconnect.
//
// This is a closed loop: `controlFacade`, `controlMediator` and `midiAccess`
// only ever read and write each other, so the mediator can live as ordinary
// closure state instead of a module-scope `let` in boot. Only two seams point
// outward and both are on the returned handle — `statusChips`, because Project
// Options repaints the musicality chip after a renderWithMixer that fires no
// onStateApplied, and `midiControlDialog`, which the menu bar opens.
//
// The whole block must run AFTER sessionHost.init(): it calls
// sessionHost.inspector.setMidiCapture and it WRAPS sessionHost.renderWithMixer,
// so the wrapper has to capture the post-init method. That patch must stay the
// only wrapper of renderWithMixer — a second one would decide by accident which
// of the two survives. It also registers an onStateApplied callback, and those
// fire in registration order, so the call site cannot drift past the other
// registrations in boot.
//
// `activeLane` is created in main.ts rather than here because SessionHost's own
// deps object (built earlier) mirrors SessionHost.activeEditLane into it from
// onActiveLaneChanged; the store has to exist before that object does.

import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';
import type { DestinationRegistry } from '../automation/destination-registry';
import type { ActiveLaneStore } from '../control/active-lane';
import type { HistoryDeps } from '../save/history-wiring';
import { isTextEditTarget } from '../save/history-wiring';
import { DEFAULT_MUSICALITY } from '../session/session';
import { createLoomFacade } from '../control/loom-facade';
import { createCountIn } from '../control/metronome';
import { createMediator } from '../control/control-mediator';
import { createMidiAccess } from '../control/web-midi-access';
import { wireControlSurfaceUI } from '../control/control-surface-ui';
import { bindMidiControlDialog } from '../control/midi-control-dialog';
import { attachComputerKeyboard } from '../control/computer-keyboard';
import { attachTransportHotkeys } from '../control/transport-hotkeys';
import { listProfiles } from '../control/profile-registry';
import { loadControlPrefs, saveControlPrefs } from '../control/persistence';
import { isKbInputEnabled } from '../core/clip-kb-input';
import { mountStatusChips } from './toolbar-status-chips';

export interface MidiControlDeps {
  ctx: AudioContext;
  sessionHost: SessionHost;
  laneResources: LaneResourceMap;
  seq: Sequencer;
  /** The one automation-destination catalogue, handed to the facade. */
  destinations: DestinationRegistry;
  /** Created in main.ts (SessionHost mirrors activeEditLane into it). */
  activeLane: ActiveLaneStore;
  /** `${laneId}.${paramId}` → KnobHandle — main.ts's automationRegistry. */
  knobRegistry: Map<string, KnobHandle>;
  /** Late-bound: main.ts assigns its HistoryDeps long after this factory runs,
   *  so the value must be read at use time (not at construction). */
  getHistoryDeps?: () => HistoryDeps | undefined;
  /** Opened from the musicality status chip. */
  openProjectOptions(): void;
}

export interface MidiControl {
  /** Toolbar chips. Project Options repaints the musicality one directly,
   *  because renderWithMixer() does not fire onStateApplied. */
  statusChips: ReturnType<typeof mountStatusChips>;
  /** The MIDI Controller dialog — the menu bar and the MIDI chip open it. */
  midiControlDialog: ReturnType<typeof bindMidiControlDialog>;
}

export function wireMidiControl(deps: MidiControlDeps): MidiControl {
  const { ctx, sessionHost, laneResources, seq, destinations, activeLane, knobRegistry } = deps;

  const controlFacade = createLoomFacade({
    ctx,
    sessionHost,
    laneResources,
    activeLane,
    knobRegistry,                       // `${laneId}.${paramId}` → KnobHandle
    destinations,                       // the one automation-destination catalogue (Task 4)
    seq,
    countIn: createCountIn(ctx, ctx.destination),   // 1-bar metronome before Rec from idle

    // Late-bound via getter: main.ts's _discreteHistoryDeps is assigned after
    // historyDeps is built (further down its boot), but loop-record commits
    // happen at user-interaction time, so the getter always sees the final value.
    get historyDeps() { return deps.getHistoryDeps?.(); },
  });

  // The computer keyboard is a MIDI-style live input: when the ⌨ Keys toggle is on,
  // musical keys play the ACTIVE lane via the facade (so chord note-FX + ● Rec
  // loop-record apply), just like a hardware MIDI keydown — no clip typing.
  attachComputerKeyboard({
    facade: controlFacade,
    getActiveLane: () => activeLane.get(),
    isEnabled: isKbInputEnabled,
    // Share the octave with the open piano-roll: z/x step from the octave shown in
    // the editor and push the change back to its display (the ◂/▸ label).
    getOctaveBase: () => sessionHost.inspectorRoll?.getOctaveBase?.() ?? null,
    onOctaveChange: (base) => sessionHost.inspectorRoll?.setOctaveBase?.(base),
  });

  // Transport hotkeys: Space = global pause/resume (exact), R = Rec toggle.
  attachTransportHotkeys({
    isTextTarget: (t) => typeof HTMLElement !== 'undefined' && isTextEditTarget(t),
    onTogglePlay: () => sessionHost.togglePlayPause(),
    onToggleRec: () => (controlFacade.isCapturing() ? controlFacade.stopCapture() : controlFacade.startCapture('merge')),
  });

  let controlMediator: ReturnType<typeof createMediator> | null = null;
  const midiAccess = createMidiAccess();   // uses globalThis.navigator

  async function enableMidiControl(overrideProfileId: string | null): Promise<{ ok: boolean; label: string }> {
    const res = await midiAccess.enable({
      forceProfileId: overrideProfileId ?? undefined,
      onEvent: (ev) => controlMediator?.handle(ev),
    });
    if (!res.ok) {
      saveControlPrefs({ enabled: false, overrideProfileId });
      statusChips.refreshMidi(false);
      const label = res.reason === 'unsupported' ? 'MIDI not supported in this browser'
        : res.reason === 'denied' ? 'permission denied'
        : 'no controller found';
      return { ok: false, label };
    }
    const profile = listProfiles().find((p) => p.id === res.profileId)!;
    controlMediator = createMediator({
      facade: controlFacade, profile, send: (b) => midiAccess.send(b), variant: res.variant,
    });
    controlMediator.refreshLeds();
    saveControlPrefs({ enabled: true, overrideProfileId });
    statusChips.refreshMidi(true);
    return { ok: true, label: `${profile.label} (${res.variant}) ✓` };
  }

  function disableMidiControl(): void {
    controlMediator?.dispose();
    controlMediator = null;
    midiAccess.disable();
    saveControlPrefs({ enabled: false, overrideProfileId: null });
    statusChips.refreshMidi(false);
  }

  wireControlSurfaceUI({
    onEnable: enableMidiControl,
    onDisable: disableMidiControl,
    profiles: listProfiles().map((p) => ({ id: p.id, label: p.label })),
    initialEnabled: loadControlPrefs().enabled,
    capture: {
      toggle: () => (controlFacade.isCapturing() ? controlFacade.stopCapture() : controlFacade.startCapture('merge')),
      isRecording: () => controlFacade.isCapturing(),
      canRecord: () => controlFacade.canCapture(),
    },
  });
  const midiControlDialog = bindMidiControlDialog();

  // ── Toolbar status chips (musicality + MIDI) ────────────────────────────────
  // Read-only surface for state whose editing moved into a dialog. `enableMidiControl`/
  // `disableMidiControl` above close over `statusChips` (defined here, referenced
  // there) — safe because those functions aren't actually invoked until later
  // (earliest call is the auto-reconnect a few lines down), by which point this
  // const is already assigned.
  const statusChips = mountStatusChips(document.getElementById('toolbar-status-chips')!, {
    getMusicality: () => sessionHost.state.musicality ?? DEFAULT_MUSICALITY,
    onOpenProjectOptions: () => deps.openProjectOptions(),
    onOpenMidiController: () => midiControlDialog.open(),
    isMidiEnabled: () => loadControlPrefs().enabled,
  });
  sessionHost.onStateApplied(() => statusChips.refreshMusicality());

  // Clip-header Rec button (Merge/Replace) — bound once sessionHost + the facade
  // both exist (mirrors setHistoryDeps/setTranscribeLoop's late-binding).
  sessionHost.inspector.setMidiCapture({
    toggle: (mode) => (controlFacade.isCapturing() ? controlFacade.stopCapture() : controlFacade.startCapture(mode)),
    isRecording: () => controlFacade.isCapturing(),
    canRecord: () => controlFacade.canCapture(),
  });

  // Keep LEDs in sync with clip launches: refresh after every mixer render.
  const _origRenderWithMixer = sessionHost.renderWithMixer.bind(sessionHost);
  sessionHost.renderWithMixer = () => { _origRenderWithMixer(); controlMediator?.refreshLeds(); };

  // Clean the device on page unload.
  window.addEventListener('beforeunload', () => disableMidiControl());

  // Auto-reconnect if the user had it enabled (browser remembers the permission grant).
  if (loadControlPrefs().enabled) {
    void enableMidiControl(loadControlPrefs().overrideProfileId);
  }

  return { statusChips, midiControlDialog };
}
