# Live MIDI control — Akai APC Key 25 (and an extensible controller-profile subsystem)

**Date:** 2026-06-05
**Status:** Design approved (pending written-spec review)
**Area:** new subsystem `src/control/`; thin facade over `src/session/` (launch/active-lane),
`src/core/knob.ts` + mixer strip, the live-audition seam, and a small UI panel.
**New modules:** `src/control/web-midi-access.ts`, `controller-profile.ts`, `profile-registry.ts`,
`control-mediator.ts`, `active-lane.ts`, `control-surface-ui.ts`, `profiles/apc-key25.ts`,
`profiles/generic-keyboard.ts`.

> This is Loom's **first live-MIDI subsystem**. `src/midi/` today is *only* the SMF (`.mid`) file
> parser/importer — there is no live MIDI input anywhere. This spec adds it, built the way the rest
> of Loom is built: **plugins behind a registry**.

## Problem / goal

Drive Loom from a hardware controller over USB (Web MIDI). The reference device is the **Akai APC
Key 25** — 25 mini keys, 40-pad 8×5 clip matrix, 8 knobs, 5 scene-launch buttons, STOP ALL, and
navigation buttons. The user owns (probably) a **mk1** but wants **both mk1 and mk2** supported with
**auto-detection**, and the architecture open so **other controllers can be added by dropping a
file** — never editing the core. A **generic MIDI-keyboard fallback** must make *something* work for
any connected device even without a specific profile.

## Decisions (locked during brainstorming)

- **Architecture = controller-profile registry + mediator (Approach A).** A new `src/control/`
  subsystem: Web-MIDI I/O isolated behind one seam, profiles are **pure functions**
  (`parse` bytes→events, `render` state→LEDs), discovered at build time via `import.meta.glob`
  exactly like engines/fx/modulators. The mediator maps abstract events to Loom through a **narrow
  facade** — the only coupling surface. Rejected: a single hard-wired APC module (not extensible);
  a generic MIDI-learn layer (no LED/grid model, out of scope).
- **mk1 + mk2, auto-detected.** One `apc-key25` profile holds a `variant: 'mk1' | 'mk2'` detected by
  MIDI port name, with a SysEx **device-inquiry** as a tiebreaker. Identical logical layout;
  per-variant differences (note/CC numbers, LED encoding, mk2 init SysEx) are encapsulated inside
  the profile.
- **Surfaces wired in v1 (all four):** keyboard, 8×5 clip matrix + LEDs, 8 knobs, scenes + STOP ALL.
- **Target lane = a single "active lane" source of truth, synced both ways (UI ↔ APC).** A new
  observable store; the UI sets it on selection, the APC sets it via LEFT/RIGHT; both subscribe.
- **Clip matrix = a fixed 8×5 viewport** (first 8 lanes × first 5 scenes) in v1. The *viewport* is a
  first-class concept so **banking (arrows scroll the window) can be added later** without rework.
- **Knobs = direct jump (no takeover/pickup).** The mk1 knobs are absolute pots; on first touch the
  parameter jumps to the knob value. (Chosen for simplicity; no physical-vs-software tracking.)
- **Knob banks (the APC's VOLUME/PAN/SEND/DEVICE buttons):**
  - **VOLUME** → knob *i* = lane *i* volume (mixer strip), within the viewport.
  - **PAN** → knob *i* = lane *i* pan.
  - **DEVICE** → the 8 knobs = the **first 8 engine params of the active lane** (haptic sound design).
  - **SEND** → the active lane's **EQ/filter** controls (Loom has no aux sends; SEND is repurposed).
- **No explicit transport.** The APC Key 25 has no dedicated play/stop. Launching a scene starts
  playback and STOP ALL stops it — that covers transport in a clip-launch workflow. No SHIFT combos.
- **LED feedback from day one.** `render()` emits **abstract LED states**; a per-variant encoder
  produces bytes. mk2 uses each **clip's own color**; mk1 uses its green/amber/blink palette.
  Blink/pulse is delegated to the device (no Loom-side animation timer).

## Non-goals (YAGNI)

- **Grid banking** (arrow-scrolling the 8×5 window over a larger session) — viewport concept ships,
  the scrolling itself is deferred to a second iteration. UP/DOWN are inert in v1.
- **Multiple simultaneous controllers.** v1 binds one surface (best match); the panel lets you pick
  if several are present, but multi-surface fan-out is out of scope.
- **Explicit transport buttons / SHIFT combos.**
- **MIDI-learn / user-remappable bindings.** Profiles are curated, not learned.
- **Velocity-curve editing, per-pad RGB customization, note-repeat, MIDI clock sync.**
- **Safari/Firefox support** beyond a clean "not supported" message (Chromium is the target).

## Architecture

```
src/control/
  web-midi-access.ts     # the ONLY Web MIDI seam: permission, port enumeration, hotplug,
                         #   raw-message fan-out, output send(). Mockable for tests + e2e.
  controller-profile.ts  # the profile SPI (types + contract) — pure
  profile-registry.ts    # import.meta.glob('./profiles/*.ts') → auto-discovered registry
  control-mediator.ts    # ControlEvent → facade calls; Loom state-change → LedCommand (delta)
  active-lane.ts         # observable "active lane" store: get/set/subscribe (single truth)
  control-surface-ui.ts  # MIDI panel: permission state, detected device, manual override, toggle
  profiles/
    apc-key25.ts         # APC profile (mk1 + mk2 variants)
    generic-keyboard.ts  # fallback: notes + CC passthrough
```

**Data flow (in):** `Web MIDI port → web-midi-access → profile.parse(bytes) → ControlEvent[] →
control-mediator → LoomControlFacade → Loom core`.

**Data flow (out / LEDs):** `Loom state change → mediator builds a SurfaceView snapshot →
profile.render(view) → LedCommand[] → diff vs lastLed → web-midi-access.send() → port`.

The mediator never sees raw MIDI bytes; the profiles never see Loom internals. The facade is the
single, mockable contract between them.

### Profile SPI (`controller-profile.ts`)

```ts
interface MIDIPortInfo { name: string; manufacturer: string; id: string; }

interface ControllerProfile {
  id: string;                                  // "apc-key25"
  detect(port: MIDIPortInfo): number;          // 0 = not mine; >0 = confidence (name/SysEx)
  parse(msg: Uint8Array, ctx: ParseCtx): ControlEvent[];  // bytes → abstract events
  render(view: SurfaceView): LedCommand[];      // Loom state → LED bytes (variant-aware)
  onConnect?(send: SendFn): void;               // e.g. mk2 init SysEx to enable host LED control
  onDisconnect?(send: SendFn): void;            // e.g. all-LEDs-off cleanup
}
```

`ParseCtx` carries the resolved `variant` and any latched modifier state (e.g. SHIFT held, current
knob bank). Profiles are otherwise stateless pure functions.

### Abstract events (`ControlEvent`)

A discriminated union — the mediator's entire input vocabulary:

`noteOn{midi,velocity}` · `noteOff{midi}` · `sustain{on}` · `octave{delta:±1}` ·
`padPress{col,row}` · `sceneLaunch{row}` · `stopAll` · `knob{index,value01}` ·
`knobBank{bank:'volume'|'pan'|'send'|'device'}` · `selectLane{delta:±1}` (LEFT/RIGHT) ·
`nav{dir}` (reserved for banking).

### Facade (`LoomControlFacade`) — the only coupling surface

```ts
interface LoomControlFacade {
  // live keyboard (reuses the existing audition seam: Voice.trigger / Voice.release)
  playLiveNote(laneId: string, midi: number, velocity: number): void;
  releaseLiveNote(laneId: string, midi: number): void;
  setSustain(laneId: string, on: boolean): void;
  // clip launch
  launchClip(laneId: string, sceneIdx: number): void;
  launchScene(sceneIdx: number): void;
  stopAll(): void;
  // knobs (direct jump)
  setKnob(laneId: string, paramId: string, value01: number): void;
  // active lane (bidirectional)
  getActiveLane(): string | null;
  setActiveLane(laneId: string): void;
  // snapshot for LED rendering
  getSurfaceView(): SurfaceView;
  // subscribe to anything that changes the LEDs (clip play-states, active lane, clip presence/color)
  onStateChange(cb: () => void): () => void;
}
```

`playLiveNote/releaseLiveNote` generalize Loom's existing **audition** path (the piano-roll
computer-keyboard preview) into proper note-on/note-off with held gate + sustain, via the `Voice`
interface's `trigger(midi,time,opts)` / `release(time)`.

### Active-lane store (`active-lane.ts`)

A tiny observable: `getActiveLane()`, `setActiveLane(id)`, `subscribe(cb)`. The session UI sets it
when a lane/clip is selected; the mediator sets it on `selectLane`. Both subscribe to reflect the
change (UI highlight + inspector ↔ any hardware indication). Setter is idempotent/guarded so a
UI-originated change that echoes back to the APC (and vice-versa) **does not loop**.

### SurfaceView (input to `render`)

```ts
interface CellState { kind: 'empty'|'stopped'|'playing'|'queued-launch'|'queued-stop'; color?: string; }
interface SurfaceView {
  variant: 'mk1' | 'mk2';
  cells: CellState[][];          // [row 0..4][col 0..7], already resolved to the viewport
  scenes: ('empty'|'has-clips'|'launched')[];  // 5 scene buttons
  anyPlaying: boolean;           // STOP ALL lit
  activeLaneCol: number | null;  // best-effort hardware hint
  knobBank: 'volume'|'pan'|'send'|'device';
}
```

Pure → fully unit-testable without hardware.

## APC Key 25 mapping (`profiles/apc-key25.ts`)

> Exact note/CC numbers are encapsulated in the profile and **verified against the device during
> implementation**; the table below is the *logical* mapping. mk1 and mk2 share the layout; only the
> raw numbers and LED encoding differ.

- **25 keys** → `noteOn/noteOff` (velocity-sensitive) → `playLiveNote/releaseLiveNote` on the active
  lane. Octave ± and sustain (button + pedal jack, CC64) supported. If the active lane is a **Drums**
  lane, notes flow into the drum engine, which already maps note→voice — drum pads "just work".
- **40 pads (8 cols × 5 rows)** → `padPress{col,row}` → `launchClip(viewportLane[col],
  viewportScene[row])`, honoring Loom's `launchQuantize`. Empty cell → no-op in v1.
- **8 knobs + 4 bank buttons** → `knob{index,value01}` + `knobBank` → `setKnob` with **direct jump**.
  Banks: VOLUME = lane volumes, PAN = lane pans, DEVICE = active lane's first 8 engine params, SEND =
  active lane's EQ/filter.
- **5 right-column buttons** → `sceneLaunch{row}` → `launchScene`. **STOP ALL** → `stopAll()`.
- **LEFT/RIGHT** → `selectLane{∓1}` → move the active lane (syncs to UI). **UP/DOWN** reserved for
  banking (inert in v1).
- **Detection:** `detect()` matches port name (`/apc key 25/i`), `mk2` when the name says so;
  ambiguous → SysEx device-inquiry as tiebreaker. Falls through to `generic-keyboard` if nothing
  matches.

## LEDs / feedback

`render(view)` maps each `CellState.kind` to an abstract LED, then a **per-variant encoder** emits
bytes:

| kind | mk1 (bicolor) | mk2 (RGB) |
|---|---|---|
| empty | off | off |
| stopped | amber | clip color (dim) |
| playing | green | clip color (bright) |
| queued-launch | green blink | pulse |
| queued-stop | amber blink | pulse |

Scene buttons: lit when the row has clips, highlighted on launch. STOP ALL: lit when `anyPlaying`.
**Active-lane hardware indication is best-effort** — the APC Key 25 has no per-column track buttons
and the bicolor matrix is scarce, so active lane is shown primarily in the UI; LEFT/RIGHT moves it.

**Blink/pulse is delegated to the device** (mk1 blink LED states, mk2 pulse channel) — Loom sets the
state, no animation timer (deliberately avoids the tab-throttling that already affects the visual
playhead).

**Anti-flood:** the mediator caches `lastLed` and `send()`s **only changed pads**. Full re-render on
(re)connect and on viewport change. mk2 receives its **init SysEx** via `onConnect` to enable host
LED control; `onDisconnect` (and page unload) sends **all-LEDs-off** to leave the device clean.

## Connection, permissions, UX

- **Feature-detect** `navigator.requestMIDIAccess`. Absent (Safari, Firefox-without-flag) → panel
  shows "MIDI not supported in this browser" and disables the feature.
- **Permission:** `requestMIDIAccess({ sysex: true })` (needed for device-inquiry + mk2 LED init).
  The browser remembers the grant per origin → later sessions reconnect seamlessly. The panel
  explains why the (scarier) SysEx prompt appears.
- **Enable flow:** a **"MIDI" button** opens the panel → request access → enumerate in/out ports →
  run every profile's `detect` → bind the highest-confidence profile and pair its output port (by
  device name/id) for LEDs → fall back to `generic-keyboard` if nothing matches.
- **Panel shows:** permission state, connected devices, detected **profile + variant** badge (e.g.
  "APC Key 25 (mk2) ✓"), a **manual override** dropdown (force a profile / assign generic), on/off
  toggle.
- **Hotplug:** `access.onstatechange` → on disconnect clear LED state + unbind; on reconnect
  re-init + full LED render.
- **Persistence:** remember enabled-state + profile override in Loom's settings → auto-reconnect
  next session.

## Testing & verification

Web MIDI can't be exercised with hardware in CI, so the design is **testable by construction** (all
I/O behind one seam; all logic pure). Maps onto Loom's existing 4-layer test culture.

1. **Profile tests (pure, the bulk).** `apc-key25.test.ts`: `parse()` byte-arrays → `ControlEvent[]`
   for both variants (key, pad, knob, scene, STOP ALL, bank buttons, octave, sustain); `render()`
   `SurfaceView` → exact `LedCommand` bytes (mk1 velocity codes, mk2 RGB index + channel + init
   SysEx); `detect()` port-name/SysEx → variant + confidence. `generic-keyboard.test.ts`: note/CC
   passthrough.
2. **Mediator tests with a fake facade.** `control-mediator.test.ts`: inject a mock
   `LoomControlFacade`; assert event→call mapping (pad → `launchClip`; DEVICE-bank knob → `setKnob`
   on active lane with jump; LEFT/RIGHT → `setActiveLane`) and that state-change triggers a
   **delta-only** LED render. `active-lane.test.ts`: set from UI side and from APC side both notify;
   **no feedback loop**.
3. **Web-MIDI seam tests.** Inject a fake `MIDIAccess` (fake inputs/outputs with `onmidimessage` /
   `send`) to exercise enumerate→detect→bind, `onstatechange` hotplug, permission-denied,
   unsupported. No hardware.
4. **e2e (Playwright) with a simulated APC.** Because all MIDI access goes through one seam, inject a
   fake `navigator.requestMIDIAccess` (init script before app load) simulating an APC: a fake input
   we push messages into, a fake output that records sent bytes. Test: enable MIDI → panel shows
   "APC Key 25 ✓" → push a pad note → assert a clip launches in the real UI → assert the fake output
   received the right LED bytes. (Repo gotcha: `test:e2e` serves stale `dist/` — `npm run build`
   first.)
5. **Hardware checklist (human, in this spec).** Connect mk1 (and mk2 if available); verify keys
   play the active lane, pads launch + LEDs reflect states, knobs in each bank
   (VOLUME/PAN/SEND=EQ/DEVICE), scene launch, STOP ALL, hotplug, auto-reconnect, all-LEDs-off on
   disable.

No WAV goldens — this is a control plane, not audio. Assertions on the control protocol are exact
byte/event matches (the protocol is discrete, not a DSP magnitude, so the "always-relative" rule
doesn't apply here).

## Future work (explicitly deferred)

- **Banking:** UP/DOWN/LEFT/RIGHT scroll the 8×5 viewport over a larger session (viewport concept
  already in place).
- **More device profiles:** Launchpad, APC mini/40, generic grid controllers — drop a file in
  `profiles/`.
- **Multiple simultaneous surfaces.**
- **Explicit transport** (SHIFT combos) and **MIDI clock** out.
- **Knob takeover modes** (pickup / value-scaling) as an option beyond direct jump.
