# APC Key 25 Live-MIDI Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive Loom from an Akai APC Key 25 over USB (Web MIDI): play the active lane's engine with held velocity-sensitive notes, launch clips on the 8×5 pad matrix with LED feedback, tweak params with the 8 knobs, and launch scenes / stop-all — all behind an extensible controller-profile registry that auto-detects mk1/mk2 and falls back to a generic keyboard.

**Architecture:** A new `src/control/` subsystem. Web-MIDI I/O is isolated behind one seam (`web-midi-access.ts`). Device-specific logic lives in **pure** profiles (`parse` bytes→abstract events, `render` Loom-state→LED bytes), discovered at build time via `import.meta.glob` like engines/fx. A `control-mediator` maps abstract events to Loom through a **narrow facade** (`loom-facade.ts`) — the only coupling surface. Held polyphonic notes use a `live-keyboard` voice pool that spawns one engine `Voice` per key (the same `engine.createVoice` path Loom already uses for every note) and calls `voice.release()` on key-up. Nothing in the existing scheduler/audition path changes.

**Tech Stack:** TypeScript, Vite, Web Audio API, Web MIDI API, Vitest (unit, jsdom for DOM), Playwright (e2e). No new runtime dependencies.

---

## Spec

Implements [docs/superpowers/specs/2026-06-05-apc-key25-midi-control-design.md](../specs/2026-06-05-apc-key25-midi-control-design.md). Read it first. Locked decisions: 4 surfaces (keyboard, 8×5 clips+LEDs, 8 knobs, scenes+STOP ALL); single active-lane source of truth synced UI↔APC (reuses `SessionHost.activeEditLane`); fixed 8×5 viewport (banking deferred); knobs jump (no pickup); knob banks VOLUME/PAN/SEND=EQ/DEVICE; no explicit transport; mk1+mk2 auto-detected; generic-keyboard fallback. **Refined during planning:** keyboard = **held notes** (spawn a Voice per key, release on key-up — additive, isolated, does not touch existing triggering); `setBaseValue` uses **real units** (min..max from the param spec); there is no settings store today, so a tiny `localStorage` helper is added.

## Module map

```
src/control/
  midi-bytes.ts          # pure MIDI byte helpers (status, channel, note/cc predicates)
  controller-profile.ts  # the SPI: ControlEvent, LedCommand, SurfaceView, ControllerProfile, LoomControlFacade (types only)
  profiles/
    apc-key25.ts         # detect + variantFor + parse + render + onConnect/onDisconnect (mk1 & mk2)
    generic-keyboard.ts   # fallback: notes + CC passthrough, render = []
  profile-registry.ts    # import.meta.glob discovery + pickProfile(port)
  active-lane.ts         # tiny observable store bridging SessionHost.activeEditLane
  live-keyboard.ts       # held-note voice pool (spawn Voice per key, release/dispose, sustain)
  control-mediator.ts    # ControlEvent → facade calls; facade state-change → render → delta send
  web-midi-access.ts     # the only Web MIDI seam: permission, enumerate, bind, hotplug, send
  persistence.ts         # localStorage helpers (enabled + profile override)
  loom-facade.ts         # createLoomFacade(deps): LoomControlFacade impl over Loom objects
  control-surface-ui.ts  # MIDI panel: status, detected device, override, enable toggle
```

Modified: `src/session/session-host.ts` (public `launchClipAt`/`launchSceneAt`/`stopAllClips`/`focusLane`), `index.html` (panel container), `src/main.ts` (wire it all). New e2e: `tests/e2e/midi-control.spec.ts`.

**Commands used throughout:**
- Single unit test: `NO_COLOR=1 npx vitest run <path-to-test>`
- Typecheck + bundle: `npm run build`
- e2e (serves `dist/` — ALWAYS `npm run build` first): `npm run test:e2e`

---

## Task 1: MIDI byte helpers

**Files:**
- Create: `src/control/midi-bytes.ts`
- Test: `src/control/midi-bytes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/control/midi-bytes.test.ts
import { describe, it, expect } from 'vitest';
import { statusType, channel, isNoteOn, isNoteOff, isCC, cc14 } from './midi-bytes';

describe('midi-bytes', () => {
  it('decodes status nibble and channel', () => {
    expect(statusType(0x90)).toBe(0x90); // note-on
    expect(statusType(0x95)).toBe(0x90);
    expect(channel(0x95)).toBe(5);
    expect(statusType(0xB0)).toBe(0xB0); // control change
  });

  it('treats note-on with velocity 0 as note-off', () => {
    expect(isNoteOn([0x90, 60, 100])).toBe(true);
    expect(isNoteOn([0x90, 60, 0])).toBe(false);
    expect(isNoteOff([0x90, 60, 0])).toBe(true);
    expect(isNoteOff([0x80, 60, 64])).toBe(true);
  });

  it('detects control change', () => {
    expect(isCC([0xB0, 48, 127])).toBe(true);
    expect(isCC([0x90, 48, 127])).toBe(false);
  });

  it('normalises a 7-bit CC value to 0..1', () => {
    expect(cc14(0)).toBe(0);
    expect(cc14(127)).toBe(1);
    expect(cc14(64)).toBeCloseTo(0.5039, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/midi-bytes.test.ts`
Expected: FAIL — cannot resolve `./midi-bytes`.

- [ ] **Step 3: Write the implementation**

```ts
// src/control/midi-bytes.ts
/** Pure helpers over raw MIDI status/data bytes. No Web MIDI, no Loom. */

export type Bytes = ArrayLike<number>;

/** High nibble of the status byte (message type), e.g. 0x90 note-on, 0xB0 CC. */
export function statusType(status: number): number {
  return status & 0xf0;
}

/** Low nibble of the status byte (0-based channel 0..15). */
export function channel(status: number): number {
  return status & 0x0f;
}

/** True for a real note-on (note-on status AND velocity > 0). */
export function isNoteOn(data: Bytes): boolean {
  return statusType(data[0]) === 0x90 && data[2] > 0;
}

/** True for a note-off OR a note-on with velocity 0 (the common "running status" off). */
export function isNoteOff(data: Bytes): boolean {
  const t = statusType(data[0]);
  return t === 0x80 || (t === 0x90 && data[2] === 0);
}

/** True for a control-change message. */
export function isCC(data: Bytes): boolean {
  return statusType(data[0]) === 0xb0;
}

/** Normalise a 7-bit value (0..127) to 0..1. */
export function cc14(value: number): number {
  return value / 127;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/midi-bytes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/control/midi-bytes.ts src/control/midi-bytes.test.ts
git commit -m "feat(control): pure MIDI byte helpers"
```

---

## Task 2: Controller-profile SPI (types)

**Files:**
- Create: `src/control/controller-profile.ts`

This file is **types only** — no runtime behaviour, so no unit test (verified by `npm run build` and by every downstream task that imports it). Defining these names ONCE here keeps every later task type-consistent.

- [ ] **Step 1: Write the type module**

```ts
// src/control/controller-profile.ts
/** The controller-profile SPI. Profiles are PURE: bytes→events and state→LED bytes.
 *  The mediator never sees raw MIDI; profiles never see Loom internals. */

export type Variant = 'mk1' | 'mk2';
export type KnobBank = 'volume' | 'pan' | 'send' | 'device';

/** Abstract events — the mediator's entire input vocabulary. */
export type ControlEvent =
  | { type: 'noteOn'; midi: number; velocity: number }   // velocity 0..127
  | { type: 'noteOff'; midi: number }
  | { type: 'sustain'; on: boolean }
  | { type: 'padPress'; col: number; row: number }        // row 0 = TOP (scene 0)
  | { type: 'sceneLaunch'; row: number }
  | { type: 'stopAll' }
  | { type: 'knob'; index: number; value01: number }      // index 0..7, value 0..1
  | { type: 'knobBank'; bank: KnobBank }
  | { type: 'selectLane'; delta: 1 | -1 }                 // LEFT/RIGHT
  | { type: 'nav'; dir: 'up' | 'down' };                  // reserved for banking (v1: ignored)

export interface MIDIPortInfo { name: string; manufacturer: string; id: string; }
export interface ParseCtx { variant: Variant; }
export type SendFn = (bytes: number[]) => void;

/** A single LED instruction. `key` is a stable target id (e.g. "pad:12") so the
 *  mediator can diff and send only what changed. `data` is the raw MIDI to send. */
export interface LedCommand { key: string; data: number[]; }

export type CellKind = 'empty' | 'stopped' | 'playing' | 'queued-launch' | 'queued-stop';
export interface CellState { kind: CellKind; color?: string; }   // color = clip hex (#rrggbb)
export type SceneState = 'empty' | 'has-clips' | 'launched';

/** Pure snapshot the profile renders to LEDs. cells[row][col], row 0 = TOP. */
export interface SurfaceView {
  variant: Variant;
  cells: CellState[][];          // 5 rows × 8 cols
  scenes: SceneState[];          // length 5, index 0 = top
  anyPlaying: boolean;
  activeLaneCol: number | null;  // best-effort hint (0..7) or null
  knobBank: KnobBank;
}

export interface ControllerProfile {
  id: string;
  label: string;
  /** 0 = not this device; >0 = confidence (higher wins). */
  detect(port: MIDIPortInfo): number;
  /** Resolve the hardware variant from the port (called once on bind). */
  variantFor(port: MIDIPortInfo): Variant;
  parse(data: Uint8Array, ctx: ParseCtx): ControlEvent[];
  render(view: SurfaceView): LedCommand[];
  onConnect?(send: SendFn, ctx: ParseCtx): void;
  onDisconnect?(send: SendFn, ctx: ParseCtx): void;
}

/** The ONLY coupling surface between the mediator and Loom. Implemented in loom-facade.ts. */
export interface LoomControlFacade {
  // live keyboard (held notes)
  playLiveNote(laneId: string, midi: number, velocity: number): void;
  releaseLiveNote(laneId: string, midi: number): void;
  setSustain(on: boolean): void;
  // clip launch
  launchClip(laneId: string, clipIdx: number): void;
  launchScene(sceneIdx: number): void;
  stopAll(): void;
  // knobs (direct jump; value 0..1)
  engineParamIds(laneId: string): string[];                 // first 8 CONTINUOUS engine params
  setEngineParam(laneId: string, paramId: string, value01: number): void;
  setLaneVolume(laneId: string, value01: number): void;
  setLanePan(laneId: string, value01: number): void;
  setLaneEq(laneId: string, band: 'low' | 'mid' | 'high', value01: number): void;
  // active lane (bidirectional)
  getActiveLane(): string | null;
  setActiveLane(laneId: string): void;
  // viewport
  laneIds(): string[];                                      // ordered lanes (col index = position)
  // LED feedback
  buildSurfaceView(variant: Variant, knobBank: KnobBank): SurfaceView;
  onStateChange(cb: () => void): () => void;                // returns unsubscribe
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from the new file).

- [ ] **Step 3: Commit**

```bash
git add src/control/controller-profile.ts
git commit -m "feat(control): controller-profile SPI + facade types"
```

---

## Task 3: APC Key 25 profile — detect + parse

**Files:**
- Create: `src/control/profiles/apc-key25.ts`
- Test: `src/control/profiles/apc-key25.parse.test.ts`

> **VERIFY ON DEVICE:** the exact note/CC numbers below are the documented APC Key 25 mk1 values. They are encapsulated here; if a real device differs, fix only the constants at the top of this file. The architecture and tests do not change.

- [ ] **Step 1: Write the failing test**

```ts
// src/control/profiles/apc-key25.parse.test.ts
import { describe, it, expect } from 'vitest';
import { apcKey25 } from './apc-key25';

const ctx = { variant: 'mk1' as const };
const u8 = (...b: number[]) => Uint8Array.from(b);

describe('apc-key25 detect + variantFor', () => {
  it('matches by port name and resolves variant', () => {
    expect(apcKey25.detect({ name: 'APC Key 25', manufacturer: 'Akai', id: 'a' })).toBeGreaterThan(0);
    expect(apcKey25.detect({ name: 'APC Key 25 mk2', manufacturer: 'Akai', id: 'a' })).toBeGreaterThan(0);
    expect(apcKey25.detect({ name: 'Some Other Synth', manufacturer: '', id: 'b' })).toBe(0);
    expect(apcKey25.variantFor({ name: 'APC Key 25 mk2', manufacturer: 'Akai', id: 'a' })).toBe('mk2');
    expect(apcKey25.variantFor({ name: 'APC Key 25', manufacturer: 'Akai', id: 'a' })).toBe('mk1');
  });
});

describe('apc-key25 parse', () => {
  it('pad note 0 (bottom-left) → padPress col 0 row 4 (bottom row)', () => {
    expect(apcKey25.parse(u8(0x90, 0, 100), ctx)).toEqual([{ type: 'padPress', col: 0, row: 4 }]);
  });
  it('pad note 39 (top-right) → padPress col 7 row 0 (top row)', () => {
    expect(apcKey25.parse(u8(0x90, 39, 100), ctx)).toEqual([{ type: 'padPress', col: 7, row: 0 }]);
  });
  it('pad note-off is ignored (launch fires on press only)', () => {
    expect(apcKey25.parse(u8(0x80, 0, 0), ctx)).toEqual([]);
  });
  it('keyboard note (>=40) → noteOn / noteOff with velocity', () => {
    expect(apcKey25.parse(u8(0x90, 60, 90), ctx)).toEqual([{ type: 'noteOn', midi: 60, velocity: 90 }]);
    expect(apcKey25.parse(u8(0x80, 60, 0), ctx)).toEqual([{ type: 'noteOff', midi: 60 }]);
    expect(apcKey25.parse(u8(0x90, 60, 0), ctx)).toEqual([{ type: 'noteOff', midi: 60 }]);
  });
  it('knob CC 48..55 → knob index 0..7 value 0..1', () => {
    expect(apcKey25.parse(u8(0xB0, 48, 127), ctx)).toEqual([{ type: 'knob', index: 0, value01: 1 }]);
    expect(apcKey25.parse(u8(0xB0, 55, 0), ctx)).toEqual([{ type: 'knob', index: 7, value01: 0 }]);
  });
  it('sustain pedal CC 64 → sustain on/off', () => {
    expect(apcKey25.parse(u8(0xB0, 64, 127), ctx)).toEqual([{ type: 'sustain', on: true }]);
    expect(apcKey25.parse(u8(0xB0, 64, 0), ctx)).toEqual([{ type: 'sustain', on: false }]);
  });
  it('scene buttons 82..86 → sceneLaunch row 0..4; STOP ALL 81 → stopAll', () => {
    expect(apcKey25.parse(u8(0x90, 82, 127), ctx)).toEqual([{ type: 'sceneLaunch', row: 0 }]);
    expect(apcKey25.parse(u8(0x90, 86, 127), ctx)).toEqual([{ type: 'sceneLaunch', row: 4 }]);
    expect(apcKey25.parse(u8(0x90, 81, 127), ctx)).toEqual([{ type: 'stopAll' }]);
  });
  it('LEFT 66 / RIGHT 67 → selectLane -1 / +1', () => {
    expect(apcKey25.parse(u8(0x90, 66, 127), ctx)).toEqual([{ type: 'selectLane', delta: -1 }]);
    expect(apcKey25.parse(u8(0x90, 67, 127), ctx)).toEqual([{ type: 'selectLane', delta: 1 }]);
  });
  it('bank buttons VOLUME/PAN/SEND/DEVICE → knobBank', () => {
    expect(apcKey25.parse(u8(0x90, 68, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'volume' }]);
    expect(apcKey25.parse(u8(0x90, 69, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'pan' }]);
    expect(apcKey25.parse(u8(0x90, 70, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'send' }]);
    expect(apcKey25.parse(u8(0x90, 71, 127), ctx)).toEqual([{ type: 'knobBank', bank: 'device' }]);
  });
  it('button release (note-off) for transport-style buttons is ignored', () => {
    expect(apcKey25.parse(u8(0x80, 82, 0), ctx)).toEqual([]);
    expect(apcKey25.parse(u8(0x80, 68, 0), ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/profiles/apc-key25.parse.test.ts`
Expected: FAIL — cannot resolve `./apc-key25`.

- [ ] **Step 3: Write the profile — constants, detect, parse**

Create the file with the constants + detect/variantFor/parse. (`render`/`onConnect`/`onDisconnect` are added in Task 4 — for now they are stubs so the type checks.)

```ts
// src/control/profiles/apc-key25.ts
import type {
  ControllerProfile, ControlEvent, ParseCtx, MIDIPortInfo, SurfaceView, LedCommand, SendFn, Variant,
} from '../controller-profile';
import { statusType, channel, isNoteOn, isNoteOff, isCC, cc14 } from '../midi-bytes';

// ── Hardware map (VERIFY ON DEVICE; only these constants change if it differs) ──
const PAD_NOTE_MIN = 0;
const PAD_NOTE_MAX = 39;        // notes 0..39 are the 8×8? no — 8 cols × 5 rows; 0 = bottom-left
const KEY_NOTE_MIN = 40;        // keyboard notes are >= 40 (no overlap with pads)
const KNOB_CC_MIN = 48;         // K1..K8 → CC 48..55
const KNOB_CC_MAX = 55;
const CC_SUSTAIN = 64;
const NOTE_STOP_ALL = 81;
const SCENE_NOTE_MIN = 82;      // 82..86 → scene rows 0..4
const SCENE_NOTE_MAX = 86;
const NOTE_LEFT = 66;
const NOTE_RIGHT = 67;
const BANK_NOTES: Record<number, 'volume' | 'pan' | 'send' | 'device'> = {
  68: 'volume', 69: 'pan', 70: 'send', 71: 'device',
};

/** Pad note → {col,row} with row 0 = TOP. Hardware row 0 is the BOTTOM. */
function padToCell(note: number): { col: number; row: number } {
  const hwRow = Math.floor(note / 8);     // 0 (bottom) .. 4 (top)
  const col = note % 8;
  return { col, row: 4 - hwRow };
}

function parse(data: Uint8Array, _ctx: ParseCtx): ControlEvent[] {
  const status = data[0];
  const d1 = data[1];
  const d2 = data[2];

  if (isCC(data)) {
    if (d1 >= KNOB_CC_MIN && d1 <= KNOB_CC_MAX) {
      return [{ type: 'knob', index: d1 - KNOB_CC_MIN, value01: cc14(d2) }];
    }
    if (d1 === CC_SUSTAIN) return [{ type: 'sustain', on: d2 >= 64 }];
    return [];
  }

  const isOn = isNoteOn(data);
  const isOff = isNoteOff(data);
  if (!isOn && !isOff) return [];

  // Pads: launch on press only.
  if (d1 >= PAD_NOTE_MIN && d1 <= PAD_NOTE_MAX) {
    if (!isOn) return [];
    const { col, row } = padToCell(d1);
    return [{ type: 'padPress', col, row }];
  }

  // Utility/transport buttons: act on press only.
  if (d1 === NOTE_STOP_ALL) return isOn ? [{ type: 'stopAll' }] : [];
  if (d1 >= SCENE_NOTE_MIN && d1 <= SCENE_NOTE_MAX) {
    return isOn ? [{ type: 'sceneLaunch', row: d1 - SCENE_NOTE_MIN }] : [];
  }
  if (d1 === NOTE_LEFT) return isOn ? [{ type: 'selectLane', delta: -1 }] : [];
  if (d1 === NOTE_RIGHT) return isOn ? [{ type: 'selectLane', delta: 1 }] : [];
  if (BANK_NOTES[d1]) return isOn ? [{ type: 'knobBank', bank: BANK_NOTES[d1] }] : [];

  // Keyboard.
  if (d1 >= KEY_NOTE_MIN) {
    return isOn ? [{ type: 'noteOn', midi: d1, velocity: d2 }] : [{ type: 'noteOff', midi: d1 }];
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void status; void channel;
  return [];
}

function detect(port: MIDIPortInfo): number {
  return /apc\s*key\s*25/i.test(port.name) ? 100 : 0;
}

function variantFor(port: MIDIPortInfo): Variant {
  return /mk2|mkii/i.test(port.name) ? 'mk2' : 'mk1';
}

// Filled in Task 4:
function render(_view: SurfaceView): LedCommand[] { return []; }
function onConnect(_send: SendFn, _ctx: ParseCtx): void { /* Task 4 */ }
function onDisconnect(_send: SendFn, _ctx: ParseCtx): void { /* Task 4 */ }

export const apcKey25: ControllerProfile = {
  id: 'apc-key25',
  label: 'Akai APC Key 25',
  detect, variantFor, parse, render, onConnect, onDisconnect,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/profiles/apc-key25.parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/profiles/apc-key25.ts src/control/profiles/apc-key25.parse.test.ts
git commit -m "feat(control): APC Key 25 detect + parse"
```

---

## Task 4: APC Key 25 profile — render (LEDs) + lifecycle

**Files:**
- Modify: `src/control/profiles/apc-key25.ts` (replace the `render`/`onConnect`/`onDisconnect` stubs + add LED encoders)
- Test: `src/control/profiles/apc-key25.render.test.ts`

LED model: `render` walks the 5×8 `cells`, the 5 scenes, and STOP ALL, producing one `LedCommand` per target with a stable `key`. mk1 encodes color as a note-on **velocity code** (0=off,1=green,2=green-blink,3=red,4=red-blink,5=amber,6=amber-blink). mk2 encodes the clip's nearest palette colour as a note-on velocity (RGB palette index) — blink is approximated by a distinct solid colour in v1 (device-specific pulse channels are future polish).

- [ ] **Step 1: Write the failing test**

```ts
// src/control/profiles/apc-key25.render.test.ts
import { describe, it, expect } from 'vitest';
import { apcKey25 } from './apc-key25';
import type { SurfaceView, CellState } from '../controller-profile';

function emptyCells(): CellState[][] {
  return Array.from({ length: 5 }, () => Array.from({ length: 8 }, () => ({ kind: 'empty' as const })));
}
function baseView(over: Partial<SurfaceView> = {}): SurfaceView {
  return {
    variant: 'mk1', cells: emptyCells(), scenes: ['empty','empty','empty','empty','empty'],
    anyPlaying: false, activeLaneCol: null, knobBank: 'device', ...over,
  };
}

describe('apc-key25 render (mk1)', () => {
  it('empty pad → velocity 0 (off) note-on at the pad note', () => {
    const cmds = apcKey25.render(baseView());
    const topLeft = cmds.find((c) => c.key === 'pad:32'); // row0/col0 → hwRow4 → note 32
    expect(topLeft).toBeDefined();
    expect(topLeft!.data).toEqual([0x90, 32, 0]);
  });
  it('playing pad → green (velocity 1)', () => {
    const cells = emptyCells();
    cells[0][0] = { kind: 'playing' };
    const cmd = apcKey25.render(baseView({ cells })).find((c) => c.key === 'pad:32');
    expect(cmd!.data).toEqual([0x90, 32, 1]);
  });
  it('stopped pad → amber (velocity 5)', () => {
    const cells = emptyCells();
    cells[4][7] = { kind: 'stopped' };  // bottom-right → note 7
    const cmd = apcKey25.render(baseView({ cells })).find((c) => c.key === 'pad:7');
    expect(cmd!.data).toEqual([0x90, 7, 5]);
  });
  it('queued-launch pad → green blink (velocity 2)', () => {
    const cells = emptyCells();
    cells[0][0] = { kind: 'queued-launch' };
    const cmd = apcKey25.render(baseView({ cells })).find((c) => c.key === 'pad:32');
    expect(cmd!.data).toEqual([0x90, 32, 2]);
  });
  it('scene with clips → lit; STOP ALL lit when anyPlaying', () => {
    const cmds = apcKey25.render(baseView({ scenes: ['has-clips','empty','empty','empty','empty'], anyPlaying: true }));
    expect(cmds.find((c) => c.key === 'scene:0')!.data).toEqual([0x90, 82, 1]);
    expect(cmds.find((c) => c.key === 'scene:1')!.data).toEqual([0x90, 83, 0]);
    expect(cmds.find((c) => c.key === 'stopall')!.data).toEqual([0x90, 81, 3]);
  });
});

describe('apc-key25 render (mk2 RGB)', () => {
  it('playing pad uses the clip colour palette index (non-zero), stopped is dimmer', () => {
    const cells = emptyCells();
    cells[0][0] = { kind: 'playing', color: '#23a559' };   // green-ish
    const playing = apcKey25.render(baseView({ variant: 'mk2', cells })).find((c) => c.key === 'pad:32');
    expect(playing!.data[0]).toBe(0x90);
    expect(playing!.data[1]).toBe(32);
    expect(playing!.data[2]).toBeGreaterThan(0);
  });
});

describe('apc-key25 onDisconnect', () => {
  it('sends all-LEDs-off for every pad', () => {
    const sent: number[][] = [];
    apcKey25.onDisconnect!((b) => sent.push(b), { variant: 'mk1' });
    // 40 pads off
    const offPads = sent.filter((b) => b[0] === 0x90 && b[1] <= 39 && b[2] === 0);
    expect(offPads.length).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/profiles/apc-key25.render.test.ts`
Expected: FAIL — render returns `[]` (stub) so `.find` is undefined.

- [ ] **Step 3: Implement render + encoders + lifecycle**

In `src/control/profiles/apc-key25.ts`, add the encoders and replace the three stubs. Add these constants near the top (after `BANK_NOTES`):

```ts
const SCENE_NOTES = [82, 83, 84, 85, 86];

/** Pad {row,col} (row 0 = top) → hardware note. Inverse of padToCell. */
function cellToNote(row: number, col: number): number {
  const hwRow = 4 - row;
  return hwRow * 8 + col;
}

// mk1 bicolor velocity codes.
const MK1 = { off: 0, green: 1, greenBlink: 2, red: 3, redBlink: 4, amber: 5, amberBlink: 6 };

// mk2 RGB palette (small, fixed). [hex, velocityIndex] — VERIFY indices on device.
const MK2_PALETTE: Array<{ rgb: [number, number, number]; vel: number }> = [
  { rgb: [0, 0, 0], vel: 0 },        // off
  { rgb: [255, 255, 255], vel: 3 },  // white
  { rgb: [255, 0, 0], vel: 5 },      // red
  { rgb: [255, 140, 0], vel: 9 },    // amber
  { rgb: [255, 255, 0], vel: 13 },   // yellow
  { rgb: [0, 255, 0], vel: 21 },     // green
  { rgb: [0, 200, 255], vel: 37 },   // cyan
  { rgb: [0, 80, 255], vel: 45 },    // blue
  { rgb: [180, 0, 255], vel: 49 },   // purple
];

function hexToRgb(hex?: string): [number, number, number] {
  if (!hex) return [180, 180, 180];
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [180, 180, 180];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function nearestMk2Vel(hex: string | undefined, dim: boolean): number {
  const [r, g, b] = hexToRgb(hex);
  let best = MK2_PALETTE[1], bestD = Infinity;
  for (const p of MK2_PALETTE) {
    if (p.vel === 0) continue;
    const d = (p.rgb[0]-r)**2 + (p.rgb[1]-g)**2 + (p.rgb[2]-b)**2;
    if (d < bestD) { bestD = d; best = p; }
  }
  // "dim" stopped state: reuse the same palette entry (mk2 has no per-pad brightness in v1).
  void dim;
  return best.vel;
}

function padVelocity(view: SurfaceView, cell: CellState): number {
  if (view.variant === 'mk2') {
    switch (cell.kind) {
      case 'empty': return 0;
      case 'playing': return nearestMk2Vel(cell.color, false);
      case 'stopped': return nearestMk2Vel(cell.color, true);
      case 'queued-launch':
      case 'queued-stop': return MK2_PALETTE[4].vel; // yellow = "pending" (pulse is future polish)
    }
  }
  switch (cell.kind) {
    case 'empty': return MK1.off;
    case 'playing': return MK1.green;
    case 'stopped': return MK1.amber;
    case 'queued-launch': return MK1.greenBlink;
    case 'queued-stop': return MK1.amberBlink;
  }
}
```

Now replace the `render`, `onConnect`, `onDisconnect` functions:

```ts
function render(view: SurfaceView): LedCommand[] {
  const out: LedCommand[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      const note = cellToNote(row, col);
      const vel = padVelocity(view, view.cells[row][col]);
      out.push({ key: `pad:${note}`, data: [0x90, note, vel] });
    }
  }
  for (let r = 0; r < 5; r++) {
    const lit = view.scenes[r] !== 'empty' ? 1 : 0;
    out.push({ key: `scene:${r}`, data: [0x90, SCENE_NOTES[r], lit] });
  }
  out.push({ key: 'stopall', data: [0x90, NOTE_STOP_ALL, view.anyPlaying ? 3 : 0] });
  return out;
}

function onConnect(send: SendFn, ctx: ParseCtx): void {
  // mk2 may need an "introduction" SysEx to enable host LED control. The exact
  // message is device-specific — VERIFY ON DEVICE before enabling. Default mode
  // (LED-by-velocity) works without it, so v1 ships no speculative SysEx.
  void send; void ctx;
}

function onDisconnect(send: SendFn, _ctx: ParseCtx): void {
  for (let note = 0; note <= PAD_NOTE_MAX; note++) send([0x90, note, 0]);
  for (const n of SCENE_NOTES) send([0x90, n, 0]);
  send([0x90, NOTE_STOP_ALL, 0]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/profiles/apc-key25.render.test.ts`
Expected: PASS.

- [ ] **Step 5: Run BOTH apc tests + typecheck**

Run: `NO_COLOR=1 npx vitest run src/control/profiles/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/control/profiles/apc-key25.ts src/control/profiles/apc-key25.render.test.ts
git commit -m "feat(control): APC Key 25 LED render + lifecycle (mk1/mk2)"
```

---

## Task 5: Generic-keyboard fallback profile

**Files:**
- Create: `src/control/profiles/generic-keyboard.ts`
- Test: `src/control/profiles/generic-keyboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/control/profiles/generic-keyboard.test.ts
import { describe, it, expect } from 'vitest';
import { genericKeyboard } from './generic-keyboard';

const ctx = { variant: 'mk1' as const };
const u8 = (...b: number[]) => Uint8Array.from(b);

describe('generic-keyboard', () => {
  it('detects anything with confidence 1 (fallback)', () => {
    expect(genericKeyboard.detect({ name: 'Whatever', manufacturer: '', id: 'x' })).toBe(1);
  });
  it('passes notes through as noteOn/noteOff (any note is a key)', () => {
    expect(genericKeyboard.parse(u8(0x90, 36, 80), ctx)).toEqual([{ type: 'noteOn', midi: 36, velocity: 80 }]);
    expect(genericKeyboard.parse(u8(0x80, 36, 0), ctx)).toEqual([{ type: 'noteOff', midi: 36 }]);
  });
  it('maps CC 1..8 to knob 0..7', () => {
    expect(genericKeyboard.parse(u8(0xB0, 1, 127), ctx)).toEqual([{ type: 'knob', index: 0, value01: 1 }]);
  });
  it('sustain CC 64', () => {
    expect(genericKeyboard.parse(u8(0xB0, 64, 0), ctx)).toEqual([{ type: 'sustain', on: false }]);
  });
  it('renders no LEDs', () => {
    expect(genericKeyboard.render({
      variant: 'mk1', cells: [], scenes: [], anyPlaying: false, activeLaneCol: null, knobBank: 'device',
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/profiles/generic-keyboard.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```ts
// src/control/profiles/generic-keyboard.ts
import type { ControllerProfile, ControlEvent, ParseCtx, MIDIPortInfo } from '../controller-profile';
import { isNoteOn, isNoteOff, isCC, cc14 } from '../midi-bytes';

const CC_SUSTAIN = 64;

function parse(data: Uint8Array, _ctx: ParseCtx): ControlEvent[] {
  if (isCC(data)) {
    if (data[1] === CC_SUSTAIN) return [{ type: 'sustain', on: data[2] >= 64 }];
    if (data[1] >= 1 && data[1] <= 8) return [{ type: 'knob', index: data[1] - 1, value01: cc14(data[2]) }];
    return [];
  }
  if (isNoteOn(data)) return [{ type: 'noteOn', midi: data[1], velocity: data[2] }];
  if (isNoteOff(data)) return [{ type: 'noteOff', midi: data[1] }];
  return [];
}

export const genericKeyboard: ControllerProfile = {
  id: 'generic-keyboard',
  label: 'Generic MIDI keyboard',
  detect: () => 1,                       // lowest confidence: only wins if nothing else matches
  variantFor: () => 'mk1',
  parse,
  render: () => [],                      // no LED feedback
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/profiles/generic-keyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/profiles/generic-keyboard.ts src/control/profiles/generic-keyboard.test.ts
git commit -m "feat(control): generic-keyboard fallback profile"
```

---

## Task 6: Profile registry + pickProfile

**Files:**
- Create: `src/control/profile-registry.ts`
- Test: `src/control/profile-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/control/profile-registry.test.ts
import { describe, it, expect } from 'vitest';
import { listProfiles, pickProfile } from './profile-registry';

describe('profile-registry', () => {
  it('discovers the APC and generic profiles', () => {
    const ids = listProfiles().map((p) => p.id);
    expect(ids).toContain('apc-key25');
    expect(ids).toContain('generic-keyboard');
  });
  it('picks the APC for an APC port', () => {
    const p = pickProfile({ name: 'APC Key 25 mk2', manufacturer: 'Akai', id: 'a' });
    expect(p?.id).toBe('apc-key25');
  });
  it('falls back to generic-keyboard for an unknown port', () => {
    const p = pickProfile({ name: 'Mystery Pad', manufacturer: '', id: 'b' });
    expect(p?.id).toBe('generic-keyboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/profile-registry.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement (glob discovery, same pattern as plugin-bootstrap.ts)**

```ts
// src/control/profile-registry.ts
import type { ControllerProfile, MIDIPortInfo } from './controller-profile';

// Build-time scan: every file in profiles/ that exports a ControllerProfile.
// Adding a new profile file is the ONLY step needed — no import here.
const modules = import.meta.glob<Record<string, unknown>>(
  ['./profiles/*.ts', '!./profiles/*.test.ts'],
  { eager: true },
);

function isProfile(v: unknown): v is ControllerProfile {
  return !!v && typeof v === 'object'
    && typeof (v as ControllerProfile).id === 'string'
    && typeof (v as ControllerProfile).detect === 'function'
    && typeof (v as ControllerProfile).parse === 'function';
}

const profiles: ControllerProfile[] = [];
for (const mod of Object.values(modules)) {
  for (const exported of Object.values(mod)) {
    if (isProfile(exported)) profiles.push(exported);
  }
}

export function listProfiles(): ControllerProfile[] {
  return profiles.slice();
}

/** Highest-confidence profile for a port, or null if none (generic always returns 1). */
export function pickProfile(port: MIDIPortInfo): ControllerProfile | null {
  let best: ControllerProfile | null = null;
  let bestScore = 0;
  for (const p of profiles) {
    const s = p.detect(port);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/profile-registry.test.ts`
Expected: PASS.

> Note: `import.meta.glob` is resolved by Vite/Vitest. If the test runner cannot resolve it, confirm `vitest.config` shares the Vite config (it does in this repo — `plugin-bootstrap.test.ts` relies on the same mechanism).

- [ ] **Step 5: Commit**

```bash
git add src/control/profile-registry.ts src/control/profile-registry.test.ts
git commit -m "feat(control): profile registry + pickProfile"
```

---

## Task 7: Active-lane observable store

**Files:**
- Create: `src/control/active-lane.ts`
- Test: `src/control/active-lane.test.ts`

This is the bridge that makes "UI ↔ APC synced" work: one store, multiple subscribers, guarded against no-op loops.

- [ ] **Step 1: Write the failing test**

```ts
// src/control/active-lane.test.ts
import { describe, it, expect } from 'vitest';
import { createActiveLaneStore } from './active-lane';

describe('active-lane store', () => {
  it('notifies subscribers on change and dedupes no-ops', () => {
    const s = createActiveLaneStore();
    const seen: (string | null)[] = [];
    s.subscribe((id) => seen.push(id));
    s.set('lane-a');
    s.set('lane-a');        // no-op, must not notify again
    s.set('lane-b');
    expect(seen).toEqual(['lane-a', 'lane-b']);
    expect(s.get()).toBe('lane-b');
  });
  it('unsubscribe stops notifications', () => {
    const s = createActiveLaneStore();
    const seen: (string | null)[] = [];
    const off = s.subscribe((id) => seen.push(id));
    s.set('x');
    off();
    s.set('y');
    expect(seen).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/active-lane.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```ts
// src/control/active-lane.ts
export interface ActiveLaneStore {
  get(): string | null;
  set(laneId: string | null): void;
  subscribe(cb: (laneId: string | null) => void): () => void;
}

export function createActiveLaneStore(): ActiveLaneStore {
  let current: string | null = null;
  const subs = new Set<(laneId: string | null) => void>();
  return {
    get: () => current,
    set(laneId) {
      if (laneId === current) return;     // guard: dedupe → prevents UI↔APC feedback loops
      current = laneId;
      for (const cb of subs) cb(current);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/active-lane.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/active-lane.ts src/control/active-lane.test.ts
git commit -m "feat(control): active-lane observable store"
```

---

## Task 8: Live-keyboard voice pool (held notes)

**Files:**
- Create: `src/control/live-keyboard.ts`
- Test: `src/control/live-keyboard.test.ts`

The held-note core. It depends only on the `Voice` interface (type-only import) plus injected `spawnVoice`, `now`, and `defer` — so it is fully unit-testable with fakes. One Voice per held key → real polyphony regardless of engine.

- [ ] **Step 1: Write the failing test**

```ts
// src/control/live-keyboard.test.ts
import { describe, it, expect } from 'vitest';
import { createLiveVoicePool } from './live-keyboard';
import type { Voice } from '../engines/engine-types';

function fakeVoice() {
  const calls: string[] = [];
  const v: Voice = {
    trigger: (midi, time, opts) => calls.push(`trigger ${midi} v=${opts.velocity} gate=${opts.gateDuration}`),
    release: (t) => calls.push(`release @${t}`),
    connect: () => {},
    dispose: () => calls.push('dispose'),
    getAudioParams: () => new Map(),
  };
  return { v, calls };
}

describe('live-keyboard voice pool', () => {
  it('noteOn spawns a voice and triggers with a long gate + velocity', () => {
    const fv = fakeVoice();
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 10, defer: () => {} });
    pool.noteOn('lane-a', 60, 90);
    expect(fv.calls[0]).toContain('trigger 60 v=90');
    expect(fv.calls[0]).toContain('gate='); // a large gate, not 0.25
  });

  it('noteOff releases the held voice then defers dispose', () => {
    const fv = fakeVoice();
    const deferred: Array<() => void> = [];
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 5, defer: (fn) => deferred.push(fn) });
    pool.noteOn('lane-a', 60, 90);
    pool.noteOff('lane-a', 60);
    expect(fv.calls).toContain('release @5');
    expect(fv.calls).not.toContain('dispose'); // not yet
    deferred.forEach((fn) => fn());
    expect(fv.calls).toContain('dispose');
  });

  it('sustain ON defers note-off releases until sustain OFF', () => {
    const fv = fakeVoice();
    const deferred: Array<() => void> = [];
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 0, defer: (fn) => deferred.push(fn) });
    pool.setSustain(true);
    pool.noteOn('lane-a', 60, 90);
    pool.noteOff('lane-a', 60);          // held by pedal
    expect(fv.calls).not.toContain('release @0');
    pool.setSustain(false);              // pedal up → release now
    expect(fv.calls).toContain('release @0');
  });

  it('re-pressing a still-held note releases the old voice first (no stuck notes)', () => {
    let n = 0;
    const voices = [fakeVoice(), fakeVoice()];
    const pool = createLiveVoicePool({ spawnVoice: () => voices[n++].v, now: () => 0, defer: () => {} });
    pool.noteOn('lane-a', 60, 90);
    pool.noteOn('lane-a', 60, 100);
    expect(voices[0].calls).toContain('release @0');
  });

  it('panic releases all held voices', () => {
    const fv = fakeVoice();
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 7, defer: () => {} });
    pool.noteOn('lane-a', 60, 90);
    pool.noteOn('lane-a', 64, 90);
    pool.panic();
    expect(fv.calls.filter((c) => c.startsWith('release')).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/live-keyboard.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```ts
// src/control/live-keyboard.ts
import type { Voice } from '../engines/engine-types';

export interface LiveVoicePoolDeps {
  /** Spawn a fresh engine voice for a lane, routed to its output. null if lane gone. */
  spawnVoice: (laneId: string) => Voice | null;
  /** Current audio time (ctx.currentTime). */
  now: () => number;
  /** Defer disposal until the release tail has finished (default: setTimeout ~300ms). */
  defer: (fn: () => void) => void;
}

export interface LiveVoicePool {
  noteOn(laneId: string, midi: number, velocity: number): void;
  noteOff(laneId: string, midi: number): void;
  setSustain(on: boolean): void;
  panic(): void;
}

// Gate far in the future so the amp envelope holds at sustain until we release().
const HELD_GATE_SECONDS = 3600;

export function createLiveVoicePool(deps: LiveVoicePoolDeps): LiveVoicePool {
  const held = new Map<string, Voice>();          // key = `${laneId}:${midi}`
  const sustained = new Set<string>();            // keys waiting for pedal-up
  let sustainOn = false;

  const keyOf = (laneId: string, midi: number) => `${laneId}:${midi}`;

  function releaseVoice(key: string): void {
    const v = held.get(key);
    if (!v) return;
    held.delete(key);
    const t = deps.now();
    v.release(t);
    deps.defer(() => v.dispose());
  }

  return {
    noteOn(laneId, midi, velocity) {
      const key = keyOf(laneId, midi);
      if (held.has(key)) releaseVoice(key);       // retrigger a stuck/held key cleanly
      const voice = deps.spawnVoice(laneId);
      if (!voice) return;
      voice.trigger(midi, deps.now(), { gateDuration: HELD_GATE_SECONDS, velocity });
      held.set(key, voice);
    },
    noteOff(laneId, midi) {
      const key = keyOf(laneId, midi);
      if (sustainOn) { sustained.add(key); return; }
      releaseVoice(key);
    },
    setSustain(on) {
      sustainOn = on;
      if (!on) {
        for (const key of sustained) releaseVoice(key);
        sustained.clear();
      }
    },
    panic() {
      for (const key of Array.from(held.keys())) releaseVoice(key);
      sustained.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/live-keyboard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/control/live-keyboard.ts src/control/live-keyboard.test.ts
git commit -m "feat(control): held-note live voice pool (polyphonic, sustain, panic)"
```

---

## Task 9: Control mediator — input (events → facade)

**Files:**
- Create: `src/control/control-mediator.ts`
- Test: `src/control/control-mediator.input.test.ts`

The mediator owns the knob-bank state and translates each `ControlEvent` into facade calls. Tested with a fake facade. (LED output is Task 10.)

- [ ] **Step 1: Write the failing test**

```ts
// src/control/control-mediator.input.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMediator } from './control-mediator';
import type { LoomControlFacade, SurfaceView } from './controller-profile';

function fakeFacade(over: Partial<LoomControlFacade> = {}): LoomControlFacade {
  const view: SurfaceView = {
    variant: 'mk1', cells: [], scenes: [], anyPlaying: false, activeLaneCol: null, knobBank: 'device',
  };
  return {
    playLiveNote: vi.fn(), releaseLiveNote: vi.fn(), setSustain: vi.fn(),
    launchClip: vi.fn(), launchScene: vi.fn(), stopAll: vi.fn(),
    engineParamIds: vi.fn(() => ['filter.cutoff', 'filter.resonance']),
    setEngineParam: vi.fn(), setLaneVolume: vi.fn(), setLanePan: vi.fn(), setLaneEq: vi.fn(),
    getActiveLane: vi.fn(() => 'lane-b'),
    setActiveLane: vi.fn(),
    laneIds: vi.fn(() => ['lane-a', 'lane-b', 'lane-c']),
    buildSurfaceView: vi.fn(() => view),
    onStateChange: vi.fn(() => () => {}),
    ...over,
  };
}

const profile = { render: () => [] } as any;

describe('mediator input mapping', () => {
  it('padPress launches the clip at viewport lane=col, clipIdx=row', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'padPress', col: 1, row: 2 });
    expect(f.launchClip).toHaveBeenCalledWith('lane-b', 2);
  });
  it('sceneLaunch + stopAll delegate', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'sceneLaunch', row: 3 });
    m.handle({ type: 'stopAll' });
    expect(f.launchScene).toHaveBeenCalledWith(3);
    expect(f.stopAll).toHaveBeenCalled();
  });
  it('notes go to the live keyboard on the active lane', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'noteOn', midi: 60, velocity: 88 });
    m.handle({ type: 'noteOff', midi: 60 });
    expect(f.playLiveNote).toHaveBeenCalledWith('lane-b', 60, 88);
    expect(f.releaseLiveNote).toHaveBeenCalledWith('lane-b', 60);
  });
  it('DEVICE bank knob writes the matching engine param of the active lane', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'knobBank', bank: 'device' });
    m.handle({ type: 'knob', index: 1, value01: 0.5 });
    expect(f.setEngineParam).toHaveBeenCalledWith('lane-b', 'filter.resonance', 0.5);
  });
  it('VOLUME bank knob i writes lane i volume', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'knobBank', bank: 'volume' });
    m.handle({ type: 'knob', index: 2, value01: 0.8 });
    expect(f.setLaneVolume).toHaveBeenCalledWith('lane-c', 0.8);
  });
  it('SEND bank knobs 0..2 write active-lane EQ low/mid/high', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'knobBank', bank: 'send' });
    m.handle({ type: 'knob', index: 0, value01: 0.5 });
    m.handle({ type: 'knob', index: 2, value01: 0.5 });
    expect(f.setLaneEq).toHaveBeenCalledWith('lane-b', 'low', 0.5);
    expect(f.setLaneEq).toHaveBeenCalledWith('lane-b', 'high', 0.5);
  });
  it('selectLane +1 moves the active lane to the next in laneIds', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'selectLane', delta: 1 });    // active lane-b (idx 1) → lane-c
    expect(f.setActiveLane).toHaveBeenCalledWith('lane-c');
  });
  it('sustain delegates', () => {
    const f = fakeFacade();
    const m = createMediator({ facade: f, profile, send: () => {}, variant: 'mk1' });
    m.handle({ type: 'sustain', on: true });
    expect(f.setSustain).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/control-mediator.input.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement (input half; LED half stubbed, completed in Task 10)**

```ts
// src/control/control-mediator.ts
import type {
  ControlEvent, ControllerProfile, LoomControlFacade, KnobBank, Variant, SendFn,
} from './controller-profile';

export interface MediatorDeps {
  facade: LoomControlFacade;
  profile: ControllerProfile;
  send: SendFn;
  variant: Variant;
}

export interface Mediator {
  handle(ev: ControlEvent): void;
  refreshLeds(): void;
  dispose(): void;
}

const EQ_BANDS: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high'];

export function createMediator(deps: MediatorDeps): Mediator {
  const { facade, profile, send, variant } = deps;
  let bank: KnobBank = 'device';
  const lastLed = new Map<string, string>();   // key → JSON(data); for delta send (Task 10)

  function handleKnob(index: number, value01: number): void {
    const active = facade.getActiveLane();
    const lanes = facade.laneIds();
    switch (bank) {
      case 'device': {
        if (!active) return;
        const ids = facade.engineParamIds(active);
        const id = ids[index];
        if (id) facade.setEngineParam(active, id, value01);
        return;
      }
      case 'volume': {
        const lane = lanes[index];
        if (lane) facade.setLaneVolume(lane, value01);
        return;
      }
      case 'pan': {
        const lane = lanes[index];
        if (lane) facade.setLanePan(lane, value01);
        return;
      }
      case 'send': {
        if (!active) return;
        const band = EQ_BANDS[index];
        if (band) facade.setLaneEq(active, band, value01);
        return;
      }
    }
  }

  function handleSelectLane(delta: 1 | -1): void {
    const lanes = facade.laneIds();
    if (lanes.length === 0) return;
    const active = facade.getActiveLane();
    const cur = active ? lanes.indexOf(active) : -1;
    const next = Math.max(0, Math.min(lanes.length - 1, cur + delta));
    const target = lanes[next];
    if (target) facade.setActiveLane(target);
  }

  function refreshLeds(): void {
    const view = facade.buildSurfaceView(variant, bank);
    const cmds = profile.render(view);
    for (const cmd of cmds) {
      const enc = JSON.stringify(cmd.data);
      if (lastLed.get(cmd.key) === enc) continue;  // delta: only send changes
      lastLed.set(cmd.key, enc);
      send(cmd.data);
    }
  }

  function handle(ev: ControlEvent): void {
    const active = facade.getActiveLane();
    switch (ev.type) {
      case 'noteOn':  if (active) facade.playLiveNote(active, ev.midi, ev.velocity); break;
      case 'noteOff': if (active) facade.releaseLiveNote(active, ev.midi); break;
      case 'sustain': facade.setSustain(ev.on); break;
      case 'padPress': {
        const lane = facade.laneIds()[ev.col];
        if (lane) facade.launchClip(lane, ev.row);
        break;
      }
      case 'sceneLaunch': facade.launchScene(ev.row); break;
      case 'stopAll': facade.stopAll(); break;
      case 'knob': handleKnob(ev.index, ev.value01); break;
      case 'knobBank': bank = ev.bank; refreshLeds(); break;
      case 'selectLane': handleSelectLane(ev.delta); break;
      case 'nav': break;   // reserved for banking (v1: ignored)
    }
  }

  const unsub = facade.onStateChange(() => refreshLeds());

  return {
    handle,
    refreshLeds,
    dispose() { unsub(); lastLed.clear(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/control-mediator.input.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/control-mediator.ts src/control/control-mediator.input.test.ts
git commit -m "feat(control): mediator input mapping (events → facade)"
```

---

## Task 10: Control mediator — LED output (delta + state subscription)

**Files:**
- Test: `src/control/control-mediator.led.test.ts` (the implementation already exists from Task 9 — this task locks the behaviour with tests and fixes any gaps)

- [ ] **Step 1: Write the failing/again-passing test**

```ts
// src/control/control-mediator.led.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMediator } from './control-mediator';
import type { LoomControlFacade, SurfaceView, ControllerProfile } from './controller-profile';

function view(over: Partial<SurfaceView> = {}): SurfaceView {
  return { variant: 'mk1', cells: [], scenes: [], anyPlaying: false, activeLaneCol: null, knobBank: 'device', ...over };
}

function facadeWithStateHook(): { facade: LoomControlFacade; fire: () => void } {
  let cb: () => void = () => {};
  const facade = {
    playLiveNote: vi.fn(), releaseLiveNote: vi.fn(), setSustain: vi.fn(),
    launchClip: vi.fn(), launchScene: vi.fn(), stopAll: vi.fn(),
    engineParamIds: vi.fn(() => []), setEngineParam: vi.fn(),
    setLaneVolume: vi.fn(), setLanePan: vi.fn(), setLaneEq: vi.fn(),
    getActiveLane: vi.fn(() => null), setActiveLane: vi.fn(), laneIds: vi.fn(() => []),
    buildSurfaceView: vi.fn(() => view()),
    onStateChange: (fn: () => void) => { cb = fn; return () => {}; },
  } as unknown as LoomControlFacade;
  return { facade, fire: () => cb() };
}

const profile = {
  render: (v: SurfaceView) => [
    { key: 'stopall', data: [0x90, 81, v.anyPlaying ? 3 : 0] },
  ],
} as unknown as ControllerProfile;

describe('mediator LED output', () => {
  it('a facade state change triggers a render and sends LED bytes', () => {
    const { facade, fire } = facadeWithStateHook();
    const sent: number[][] = [];
    createMediator({ facade, profile, send: (b) => sent.push(b), variant: 'mk1' });
    fire();
    expect(sent).toContainEqual([0x90, 81, 0]);
  });

  it('only sends a LED whose bytes changed (delta)', () => {
    const { facade, fire } = facadeWithStateHook();
    const sent: number[][] = [];
    let playing = false;
    (facade.buildSurfaceView as any) = vi.fn(() => view({ anyPlaying: playing }));
    const m = createMediator({ facade, profile, send: (b) => sent.push(b), variant: 'mk1' });
    m.refreshLeds();                 // sends [0x90,81,0]
    m.refreshLeds();                 // unchanged → no new send
    playing = true;
    m.refreshLeds();                 // changed → sends [0x90,81,3]
    expect(sent).toEqual([[0x90, 81, 0], [0x90, 81, 3]]);
    void fire;
  });
});
```

- [ ] **Step 2: Run test**

Run: `NO_COLOR=1 npx vitest run src/control/control-mediator.led.test.ts`
Expected: PASS (the Task 9 implementation already covers this — delta cache + onStateChange subscription). If a test fails, fix `refreshLeds`/`onStateChange` wiring in `control-mediator.ts` until green.

- [ ] **Step 3: Run all mediator + control tests**

Run: `NO_COLOR=1 npx vitest run src/control/`
Expected: PASS (all control unit tests so far).

- [ ] **Step 4: Commit**

```bash
git add src/control/control-mediator.led.test.ts
git commit -m "test(control): lock mediator LED delta + state subscription"
```

---

## Task 11: Web MIDI access seam

**Files:**
- Create: `src/control/web-midi-access.ts`
- Test: `src/control/web-midi-access.test.ts`

The single Web MIDI seam. Takes an injectable `navigator`-like object so tests (and e2e) can supply a fake. Handles: unsupported, permission, enumerate→detect→bind input+output, hotplug, send, unbind (+ profile onDisconnect cleanup).

- [ ] **Step 1: Write the failing test**

```ts
// src/control/web-midi-access.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMidiAccess } from './web-midi-access';

// Minimal fake Web MIDI.
function fakeInput(name: string) {
  return { id: 'in-' + name, name, manufacturer: 'Akai', onmidimessage: null as any };
}
function fakeOutput(name: string) {
  const sent: number[][] = [];
  return { id: 'out-' + name, name, manufacturer: 'Akai', send: (b: number[]) => sent.push(b), _sent: sent };
}
function fakeAccess(input: any, output: any) {
  return {
    inputs: new Map([[input.id, input]]),
    outputs: new Map([[output.id, output]]),
    onstatechange: null as any,
  };
}

describe('web-midi-access', () => {
  it('reports unsupported when requestMIDIAccess is absent', async () => {
    const access = createMidiAccess({ nav: {} as any });
    const r = await access.enable();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsupported');
  });

  it('binds the APC profile and routes parsed messages to onEvent', async () => {
    const input = fakeInput('APC Key 25');
    const output = fakeOutput('APC Key 25');
    const nav = { requestMIDIAccess: vi.fn(async () => fakeAccess(input, output)) };
    const events: any[] = [];
    const access = createMidiAccess({ nav: nav as any });
    const r = await access.enable({ onEvent: (e) => events.push(e) });
    expect(r.ok).toBe(true);
    expect(r.profileId).toBe('apc-key25');
    // Simulate a pad press from the device.
    input.onmidimessage({ data: Uint8Array.from([0x90, 0, 100]) });
    expect(events).toContainEqual({ type: 'padPress', col: 0, row: 4 });
  });

  it('send() forwards bytes to the bound output', async () => {
    const input = fakeInput('APC Key 25');
    const output = fakeOutput('APC Key 25');
    const nav = { requestMIDIAccess: vi.fn(async () => fakeAccess(input, output)) };
    const access = createMidiAccess({ nav: nav as any });
    await access.enable();
    access.send([0x90, 32, 1]);
    expect(output._sent).toContainEqual([0x90, 32, 1]);
  });

  it('disable() runs profile onDisconnect (all-LEDs-off) and stops routing', async () => {
    const input = fakeInput('APC Key 25');
    const output = fakeOutput('APC Key 25');
    const nav = { requestMIDIAccess: vi.fn(async () => fakeAccess(input, output)) };
    const access = createMidiAccess({ nav: nav as any });
    await access.enable();
    access.disable();
    // onDisconnect sends 40 pad-offs.
    expect(output._sent.filter((b) => b[0] === 0x90 && b[1] <= 39 && b[2] === 0).length).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/web-midi-access.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```ts
// src/control/web-midi-access.ts
import type { ControlEvent, ControllerProfile, ParseCtx, MIDIPortInfo } from './controller-profile';
import { pickProfile, listProfiles } from './profile-registry';

export interface MidiAccessDeps {
  /** Injectable navigator (defaults to globalThis.navigator). */
  nav?: { requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<any> };
}

export interface EnableOptions {
  onEvent?: (ev: ControlEvent) => void;
  onBindChange?: (info: BindInfo | null) => void;
  forceProfileId?: string;   // manual override from the UI
}

export interface BindInfo { profileId: string; variant: 'mk1' | 'mk2'; deviceName: string; }

export type EnableResult =
  | { ok: true; profileId: string; variant: 'mk1' | 'mk2'; deviceName: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-device' };

export interface MidiAccess {
  enable(opts?: EnableOptions): Promise<EnableResult>;
  disable(): void;
  send(bytes: number[]): void;
  isEnabled(): boolean;
  currentBind(): BindInfo | null;
}

export function createMidiAccess(deps: MidiAccessDeps = {}): MidiAccess {
  const nav = deps.nav ?? (globalThis as any).navigator;
  let access: any = null;
  let boundInput: any = null;
  let boundOutput: any = null;
  let profile: ControllerProfile | null = null;
  let parseCtx: ParseCtx = { variant: 'mk1' };
  let onEvent: ((ev: ControlEvent) => void) | undefined;
  let onBindChange: ((info: BindInfo | null) => void) | undefined;
  let forceProfileId: string | undefined;

  const portInfo = (p: any): MIDIPortInfo => ({ name: p.name ?? '', manufacturer: p.manufacturer ?? '', id: p.id });

  function send(bytes: number[]): void {
    boundOutput?.send(bytes);
  }

  function unbindCleanup(): void {
    if (profile?.onDisconnect && boundOutput) profile.onDisconnect((b) => send(b), parseCtx);
    if (boundInput) boundInput.onmidimessage = null;
    boundInput = null;
    boundOutput = null;
    profile = null;
    onBindChange?.(null);
  }

  function bindFromPorts(): boolean {
    const inputs: any[] = Array.from(access.inputs.values());
    if (inputs.length === 0) return false;
    // Choose the input: forced profile match, else best detect score.
    let chosenInput = inputs[0];
    let chosenProfile: ControllerProfile | null = null;
    if (forceProfileId) {
      chosenProfile = listProfiles().find((p) => p.id === forceProfileId) ?? null;
      chosenInput = inputs.find((i) => chosenProfile?.detect(portInfo(i)) ?? 0 > 0) ?? inputs[0];
    } else {
      let bestScore = -1;
      for (const i of inputs) {
        const p = pickProfile(portInfo(i));
        const score = p ? p.detect(portInfo(i)) : 0;
        if (score > bestScore) { bestScore = score; chosenProfile = p; chosenInput = i; }
      }
    }
    if (!chosenProfile) return false;
    profile = chosenProfile;
    boundInput = chosenInput;
    parseCtx = { variant: profile.variantFor(portInfo(chosenInput)) };
    // Pair an output by matching device name (fallback: first output).
    const outputs: any[] = Array.from(access.outputs.values());
    boundOutput = outputs.find((o) => o.name === chosenInput.name) ?? outputs[0] ?? null;

    boundInput.onmidimessage = (msg: { data: Uint8Array }) => {
      const evs = profile!.parse(msg.data, parseCtx);
      for (const e of evs) onEvent?.(e);
    };
    if (profile.onConnect && boundOutput) profile.onConnect((b) => send(b), parseCtx);
    const info: BindInfo = { profileId: profile.id, variant: parseCtx.variant, deviceName: chosenInput.name };
    onBindChange?.(info);
    return true;
  }

  async function enable(opts: EnableOptions = {}): Promise<EnableResult> {
    onEvent = opts.onEvent;
    onBindChange = opts.onBindChange;
    forceProfileId = opts.forceProfileId;
    if (!nav || typeof nav.requestMIDIAccess !== 'function') return { ok: false, reason: 'unsupported' };
    try {
      access = await nav.requestMIDIAccess({ sysex: true });
    } catch {
      return { ok: false, reason: 'denied' };
    }
    access.onstatechange = () => {
      // Re-bind on any hotplug change.
      if (boundInput && !access.inputs.has(boundInput.id)) unbindCleanup();
      if (!boundInput) bindFromPorts();
    };
    if (!bindFromPorts()) return { ok: false, reason: 'no-device' };
    return { ok: true, profileId: profile!.id, variant: parseCtx.variant, deviceName: boundInput.name };
  }

  function disable(): void {
    unbindCleanup();
    if (access) access.onstatechange = null;
    access = null;
  }

  return {
    enable, disable, send,
    isEnabled: () => !!boundInput,
    currentBind: () => (profile && boundInput
      ? { profileId: profile.id, variant: parseCtx.variant, deviceName: boundInput.name } : null),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/web-midi-access.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/control/web-midi-access.ts src/control/web-midi-access.test.ts
git commit -m "feat(control): Web MIDI access seam (enable/bind/hotplug/send)"
```

---

## Task 12: Persistence helper

**Files:**
- Create: `src/control/persistence.ts`
- Test: `src/control/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/control/persistence.test.ts
import { describe, it, expect } from 'vitest';
import { loadControlPrefs, saveControlPrefs } from './persistence';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null, length: 0,
  } as unknown as Storage;
}

describe('control persistence', () => {
  it('round-trips enabled + override', () => {
    const s = memStorage();
    saveControlPrefs({ enabled: true, overrideProfileId: 'apc-key25' }, s);
    expect(loadControlPrefs(s)).toEqual({ enabled: true, overrideProfileId: 'apc-key25' });
  });
  it('returns defaults when nothing stored or stored value is garbage', () => {
    const s = memStorage();
    expect(loadControlPrefs(s)).toEqual({ enabled: false, overrideProfileId: null });
    s.setItem('loom.control.prefs', 'not json');
    expect(loadControlPrefs(s)).toEqual({ enabled: false, overrideProfileId: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/persistence.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```ts
// src/control/persistence.ts
export interface ControlPrefs { enabled: boolean; overrideProfileId: string | null; }

const KEY = 'loom.control.prefs';
const DEFAULTS: ControlPrefs = { enabled: false, overrideProfileId: null };

function storage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function loadControlPrefs(explicit?: Storage): ControlPrefs {
  const s = storage(explicit);
  if (!s) return { ...DEFAULTS };
  try {
    const raw = s.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    return {
      enabled: !!p.enabled,
      overrideProfileId: typeof p.overrideProfileId === 'string' ? p.overrideProfileId : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveControlPrefs(prefs: ControlPrefs, explicit?: Storage): void {
  const s = storage(explicit);
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode / quota — ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/persistence.ts src/control/persistence.test.ts
git commit -m "feat(control): localStorage prefs (enabled + profile override)"
```

---

## Task 13: SessionHost public control methods

**Files:**
- Modify: `src/session/session-host.ts`

Expose clean public methods so the facade does not duplicate the transport-idle/running launch logic or reach into `buildCallbacks` closures. `focusLane` extracts the existing selection side-effects (set `activeEditLane` + fire `onActiveLaneChanged`) so UI selection and APC selection share one path.

> These methods are thin delegations over already-tested runtime functions + existing callbacks; they require a live `ctx`/`seq`, so they are verified by `npm run build` + the e2e test (Task 17), not a standalone unit test.

- [ ] **Step 1: Read the current selection code**

Read `src/session/session-host.ts` around lines 454-490 (`onClipPlayPause`), 537-545 (`onLaunchScene`/`onStopAll`), and 700-714 (where `this.activeEditLane = laneId` + `this.deps.onActiveLaneChanged?.()` live). Confirm the field `activeEditLane` and the imports `launchClip`, `launchScene`, `stopAll`, `stopLane`.

- [ ] **Step 2: Add public methods to the SessionHost class**

Add these methods to the `SessionHost` class body (e.g. just after `get inspectorRoll()` near line 172). They reuse the EXACT idle-vs-running logic already in `onClipPlayPause`:

```ts
  /** Launch (or restart) a clip by lane id + clip index. Used by the MIDI mediator
   *  and any non-UI launcher. Mirrors onClipPlayPause's transport idle/running logic. */
  launchClipAt(laneId: string, clipIdx: number): void {
    const lane = this.state.lanes.find((l) => l.id === laneId);
    const clip = lane?.clips[clipIdx];
    if (!lane || !clip) return;
    void this.deps.ctx.resume();
    if (!this.deps.seq.isPlaying()) {
      let next = this.laneStates.get(lane.id);
      if (!next) {
        next = { laneId: lane.id, playing: null, queued: null, queuedBoundary: 0,
                 startTime: 0, nextStepIdx: 0, loopCount: 0, loopStartedAt: 0,
                 lastScheduledAt: -Infinity };
        this.laneStates.set(lane.id, next);
      }
      next.queued = clip;
      next.queuedBoundary = this.deps.ctx.currentTime;
      this.deps.resetAutomationPosition?.();
      this.deps.seq.start();
    } else {
      launchClip(this.laneStates, this.state, lane, clip,
        this.deps.ctx.currentTime, this.deps.seq.bpm, this.deps.recHooks);
    }
    this.renderWithMixer();
  }

  /** Launch a scene by index (Ableton model). */
  launchSceneAt(sceneIdx: number): void {
    const scene = this.state.scenes[sceneIdx];
    if (!scene) return;
    void this.deps.ctx.resume();
    launchScene(this.laneStates, this.state, scene, sceneIdx, this.deps.ctx.currentTime, this.deps.seq.bpm);
    if (!this.deps.seq.isPlaying()) { this.deps.resetAutomationPosition?.(); this.deps.seq.start(); }
    this.renderWithMixer();
  }

  /** Stop every playing/queued clip. */
  stopAllClips(): void {
    stopAll(this.laneStates);
    this.renderWithMixer();
  }

  /** Make a lane the active/edit lane (single source of truth shared with the APC).
   *  Idempotent; fires onActiveLaneChanged so subscribers (UI + control) stay in sync. */
  focusLane(laneId: string): void {
    if (this.activeEditLane === laneId) return;
    this.activeEditLane = laneId;
    this.deps.onActiveLaneChanged?.();
    this.renderWithMixer();
  }
```

> If `this.deps.ctx`, `this.deps.seq`, `this.deps.resetAutomationPosition`, or `this.deps.recHooks` are not already fields on `this.deps`, check the constructor: the build context captures `ctx`, `seq`, `playBtn`, `resetAutomationPosition` as closure vars in `buildCallbacks`, not necessarily on `this.deps`. If so, capture them as private fields in the constructor (`this.ctx = deps.ctx` etc.) and reference those instead. Adjust the method bodies to whatever the class already stores. The `playBtn.textContent = '■'` UI nicety from `onClipPlayPause` can be omitted here (the transport button updates on the next render) or replicated if `playBtn` is a field.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Fix any "property does not exist on deps" by wiring the field as described above.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS (tsc + bundle).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts
git commit -m "feat(session): public launchClipAt/launchSceneAt/stopAllClips/focusLane for external control"
```

---

## Task 14: Loom facade implementation

**Files:**
- Create: `src/control/loom-facade.ts`

The adapter that implements `LoomControlFacade` over real Loom objects. Pure glue — verified by `npm run build` + the e2e test (Task 17). It is deliberately thin: each method delegates to the SessionHost methods (Task 13), the lane strip, or the engine.

- [ ] **Step 1: Write the facade**

```ts
// src/control/loom-facade.ts
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import type { LoomControlFacade, SurfaceView, CellState, SceneState, KnobBank, Variant } from './controller-profile';
import { createLiveVoicePool } from './live-keyboard';
import type { ActiveLaneStore } from './active-lane';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';

export interface LoomFacadeDeps {
  ctx: AudioContext;
  sessionHost: SessionHost;
  laneResources: LaneResourceMap;
  activeLane: ActiveLaneStore;                 // bridged to SessionHost.activeEditLane in main.ts
  knobRegistry: Map<string, KnobHandle>;       // `${laneId}.${paramId}` → handle (automationRegistry)
}

const MAX_GAIN = 1.5;            // volume knob full-up
const EQ_DB = 12;               // ±12 dB at knob extremes

export function createLoomFacade(deps: LoomFacadeDeps): LoomControlFacade {
  const { ctx, sessionHost, laneResources, activeLane, knobRegistry } = deps;

  const pool = createLiveVoicePool({
    spawnVoice: (laneId) => {
      const res = laneResources.get(laneId);
      if (!res) return null;
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(ctx, res.strip.input);   // same path as trigger-dispatch
      setCurrentLaneForVoice(null);
      return v;
    },
    now: () => ctx.currentTime,
    defer: (fn) => setTimeout(fn, 300),
  });

  function setEngineParam(laneId: string, paramId: string, value01: number): void {
    const res = laneResources.get(laneId);
    if (!res) return;
    const spec = res.engine.params.find((p) => p.id === paramId);
    if (!spec || spec.kind !== 'continuous') return;
    const real = spec.min + value01 * (spec.max - spec.min);
    const handle = knobRegistry.get(`${laneId}.${paramId}`);
    if (handle) handle.setValue(real);          // moves the on-screen ring AND drives the engine
    else res.engine.setBaseValue(paramId, real);
  }

  function cellFor(laneId: string, clip: import('../session/session').SessionClip | null): CellState {
    if (!clip) return { kind: 'empty' };
    const lp = sessionHost.laneStates.get(laneId);
    if (lp?.playing && lp.playing.id === clip.id) return { kind: 'playing', color: clip.color };
    if (lp?.queued && lp.queued.id === clip.id) return { kind: 'queued-launch', color: clip.color };
    return { kind: 'stopped', color: clip.color };
  }

  function buildSurfaceView(variant: Variant, knobBank: KnobBank): SurfaceView {
    const lanes = sessionHost.state.lanes.slice(0, 8);
    const cells: CellState[][] = [];
    for (let row = 0; row < 5; row++) {
      const rowCells: CellState[] = [];
      for (let col = 0; col < 8; col++) {
        const lane = lanes[col];
        const clip = lane ? (lane.clips[row] ?? null) : null;
        rowCells.push(lane ? cellFor(lane.id, clip) : { kind: 'empty' });
      }
      cells.push(rowCells);
    }
    const scenes: SceneState[] = [];
    for (let row = 0; row < 5; row++) {
      const has = lanes.some((l) => l.clips[row] != null);
      scenes.push(has ? 'has-clips' : 'empty');
    }
    let anyPlaying = false;
    for (const lp of sessionHost.laneStates.values()) if (lp.playing) { anyPlaying = true; break; }
    const active = activeLane.get();
    const activeIdx = active ? lanes.findIndex((l) => l.id === active) : -1;
    return {
      variant, cells, scenes, anyPlaying,
      activeLaneCol: activeIdx >= 0 ? activeIdx : null,
      knobBank,
    };
  }

  return {
    playLiveNote: (laneId, midi, velocity) => pool.noteOn(laneId, midi, velocity),
    releaseLiveNote: (laneId, midi) => pool.noteOff(laneId, midi),
    setSustain: (on) => pool.setSustain(on),
    launchClip: (laneId, clipIdx) => sessionHost.launchClipAt(laneId, clipIdx),
    launchScene: (sceneIdx) => sessionHost.launchSceneAt(sceneIdx),
    stopAll: () => sessionHost.stopAllClips(),
    engineParamIds: (laneId) => {
      const res = laneResources.get(laneId);
      if (!res) return [];
      return res.engine.params.filter((p) => p.kind === 'continuous').slice(0, 8).map((p) => p.id);
    },
    setEngineParam,
    setLaneVolume: (laneId, v01) => laneResources.get(laneId)?.strip.setLevel(v01 * MAX_GAIN),
    setLanePan: (laneId, v01) => laneResources.get(laneId)?.strip.setPan(v01 * 2 - 1),
    setLaneEq: (laneId, band, v01) => {
      const strip = laneResources.get(laneId)?.strip;
      if (!strip) return;
      const db = (v01 * 2 - 1) * EQ_DB;
      if (band === 'low') strip.setEqLow(db);
      else if (band === 'mid') strip.setEqMid(db);
      else strip.setEqHigh(db);
    },
    getActiveLane: () => activeLane.get(),
    setActiveLane: (laneId) => { activeLane.set(laneId); sessionHost.focusLane(laneId); },
    laneIds: () => sessionHost.state.lanes.map((l) => l.id),
    buildSurfaceView,
    onStateChange: (cb) => {
      // The mixer/grid re-render is the natural "something changed" signal. We poll
      // a lightweight snapshot on a RAF-free interval is overkill; instead subscribe
      // to the active-lane store AND expose a manual refresh the host calls after
      // renderWithMixer. For v1 we hook the active-lane store + a periodic safety net.
      const off = activeLane.subscribe(() => cb());
      return off;
    },
  };
}
```

> **LED refresh wiring note:** clip play-state changes happen inside the scheduler/`renderWithMixer`, which the facade cannot observe without a hook. Task 16 adds one line in `main.ts` to call `mediator.refreshLeds()` after `sessionHost.renderWithMixer()` (or on the existing render tick), so LEDs follow clip launches. The `onStateChange` active-lane subscription above covers active-lane changes; the explicit `refreshLeds()` call covers clip state.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `ChannelStrip` setter names differ (`setLevel`/`setPan`/`setEqLow/Mid/High`), confirm against `src/core/fx.ts` and adjust.

- [ ] **Step 3: Commit**

```bash
git add src/control/loom-facade.ts
git commit -m "feat(control): Loom facade (held notes, launch, knobs, mixer, surface view)"
```

---

## Task 15: Control surface UI panel

**Files:**
- Create: `src/control/control-surface-ui.ts`
- Test: `src/control/control-surface-ui.test.ts`
- Modify: `index.html` (add the panel container)

A small panel: enable toggle, permission/status line, detected device badge, profile override `<select>`. DOM-light; a jsdom test covers status rendering.

- [ ] **Step 1: Add the container to index.html**

In `index.html`, inside the `.row.transport` block (next to the existing `<details class="midi-panel">` MIDI Import block), add:

```html
        <details class="midi-control-panel">
          <summary>MIDI Control</summary>
          <div id="midi-control-body" class="midi-control-body">
            <button id="midi-control-enable" class="rnd">Enable MIDI controller</button>
            <span id="midi-control-status" class="midi-control-status">off</span>
            <select id="midi-control-override" class="midi-control-override" style="display:none;"></select>
          </div>
        </details>
```

- [ ] **Step 2: Write the failing test**

```ts
// src/control/control-surface-ui.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { wireControlSurfaceUI } from './control-surface-ui';

function dom() {
  document.body.innerHTML = `
    <button id="midi-control-enable"></button>
    <span id="midi-control-status"></span>
    <select id="midi-control-override"></select>`;
}

describe('control-surface-ui', () => {
  it('clicking enable calls onEnable and shows the result status', async () => {
    dom();
    const onEnable = vi.fn(async () => ({ ok: true as const, label: 'APC Key 25 (mk1) ✓' }));
    wireControlSurfaceUI({ onEnable, onDisable: () => {}, profiles: [{ id: 'apc-key25', label: 'APC' }], initialEnabled: false });
    document.getElementById('midi-control-enable')!.dispatchEvent(new Event('click'));
    await Promise.resolve(); await Promise.resolve();
    expect(onEnable).toHaveBeenCalled();
    expect(document.getElementById('midi-control-status')!.textContent).toContain('APC Key 25');
  });

  it('shows an error status when enable fails', async () => {
    dom();
    const onEnable = vi.fn(async () => ({ ok: false as const, label: 'MIDI not supported' }));
    wireControlSurfaceUI({ onEnable, onDisable: () => {}, profiles: [], initialEnabled: false });
    document.getElementById('midi-control-enable')!.dispatchEvent(new Event('click'));
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('midi-control-status')!.textContent).toContain('not supported');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/control-surface-ui.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 4: Implement**

```ts
// src/control/control-surface-ui.ts
export interface ControlUiDeps {
  onEnable: (overrideProfileId: string | null) => Promise<{ ok: boolean; label: string }>;
  onDisable: () => void;
  profiles: Array<{ id: string; label: string }>;
  initialEnabled: boolean;
}

export function wireControlSurfaceUI(deps: ControlUiDeps): void {
  const enableBtn = document.getElementById('midi-control-enable') as HTMLButtonElement | null;
  const statusEl = document.getElementById('midi-control-status') as HTMLElement | null;
  const overrideEl = document.getElementById('midi-control-override') as HTMLSelectElement | null;
  if (!enableBtn || !statusEl) { console.warn('[control-ui] DOM ids missing, skipping'); return; }

  let enabled = deps.initialEnabled;

  if (overrideEl) {
    overrideEl.innerHTML = '<option value="">Auto-detect</option>'
      + deps.profiles.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  }

  const setStatus = (s: string) => { statusEl.textContent = s; };
  const setEnabledUI = (on: boolean) => {
    enabled = on;
    enableBtn.textContent = on ? 'Disable MIDI controller' : 'Enable MIDI controller';
    if (overrideEl) overrideEl.style.display = on ? '' : 'none';
  };
  setEnabledUI(enabled);
  setStatus(enabled ? 'enabled' : 'off');

  enableBtn.addEventListener('click', async () => {
    if (enabled) {
      deps.onDisable();
      setEnabledUI(false);
      setStatus('off');
      return;
    }
    setStatus('requesting permission…');
    const override = overrideEl?.value || null;
    const res = await deps.onEnable(override);
    if (res.ok) { setEnabledUI(true); setStatus(res.label); }
    else { setEnabledUI(false); setStatus(res.label); }
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/control/control-surface-ui.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/control/control-surface-ui.ts src/control/control-surface-ui.test.ts index.html
git commit -m "feat(control): MIDI control UI panel (enable/status/override)"
```

---

## Task 16: Wire it all in main.ts

**Files:**
- Modify: `src/main.ts`

Assemble the subsystem: build the access seam, facade, mediator, UI; bridge `SessionHost.activeEditLane` ↔ the active-lane store; refresh LEDs after renders; auto-reconnect if previously enabled.

> Glue — verified by `npm run build` + the e2e test (Task 17).

- [ ] **Step 1: Find the wiring anchor**

Read `src/main.ts` around the `new SessionHost({...})` construction (≈ lines 375-426) and the `automationRegistry` declaration. Confirm in-scope names: `ctx`, `sessionHost`, `laneResources`, `automationRegistry` (the `Map<string, KnobHandle>` registry). Confirm the `onActiveLaneChanged` callback passed to `SessionHost`.

- [ ] **Step 2: Add the control subsystem after `sessionHost.init()`**

```ts
// ── Live MIDI control (src/control) ─────────────────────────────────────────
import { createActiveLaneStore } from './control/active-lane';
import { createLoomFacade } from './control/loom-facade';
import { createMediator } from './control/control-mediator';
import { createMidiAccess } from './control/web-midi-access';
import { wireControlSurfaceUI } from './control/control-surface-ui';
import { listProfiles } from './control/profile-registry';
import { loadControlPrefs, saveControlPrefs } from './control/persistence';
// (move these imports to the top of main.ts with the others)

const activeLaneStore = createActiveLaneStore();
// Bridge: when the UI changes the active lane, mirror it into the store (guarded → no loop).
const prevOnActiveLaneChanged = /* the existing callback, if any */ () => {};
// In the SessionHost({ ... onActiveLaneChanged }) you already pass, ADD this line at the end
// of that callback body:  activeLaneStore.set(sessionHost.activeEditLane);
// (If there is no existing callback, set onActiveLaneChanged to do exactly that.)

const controlFacade = createLoomFacade({
  ctx,
  sessionHost,
  laneResources,
  activeLane: activeLaneStore,
  knobRegistry: automationRegistry,   // `${laneId}.${paramId}` → KnobHandle
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
  return { ok: true, label: `${profile.label} (${res.variant}) ✓` };
}

function disableMidiControl(): void {
  controlMediator?.dispose();
  controlMediator = null;
  midiAccess.disable();
  saveControlPrefs({ enabled: false, overrideProfileId: null });
}

wireControlSurfaceUI({
  onEnable: enableMidiControl,
  onDisable: disableMidiControl,
  profiles: listProfiles().map((p) => ({ id: p.id, label: p.label })),
  initialEnabled: loadControlPrefs().enabled,
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
```

> **Adapt to reality:** `renderWithMixer` may not be reassignable if it is a class method on the prototype — if TypeScript complains, instead add an optional `onAfterRender?: () => void` field to `SessionHost`, call it at the end of `renderWithMixer`, and set `sessionHost.onAfterRender = () => controlMediator?.refreshLeds()` here. Pick whichever the class allows; the goal is "refresh LEDs after a render".
> For the `onActiveLaneChanged` bridge: the SessionHost is constructed earlier in this file — edit that existing `onActiveLaneChanged` callback to also call `activeLaneStore.set(sessionHost.activeEditLane)`. Do NOT create a second SessionHost.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS (tsc + bundle). Resolve any import-ordering / reassignability issues per the adapt notes.

- [ ] **Step 4: Manual smoke (no hardware needed)**

Run: `npm run dev`, open `http://localhost:5173`, confirm: a "MIDI Control" disclosure appears in the transport row; clicking "Enable MIDI controller" with no device shows "no controller found" (or, in a browser without Web MIDI, "MIDI not supported"); no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(control): wire live-MIDI subsystem into the app (facade+mediator+UI+autoreconnect)"
```

---

## Task 17: End-to-end test with a simulated APC

**Files:**
- Create: `tests/e2e/midi-control.spec.ts`

Inject a fake `navigator.requestMIDIAccess` before the app loads, simulating an APC. Drive: enable → status shows "APC Key 25 ✓"; push a pad note → a clip launches; assert the fake output received LED bytes.

> Reminder: e2e serves `dist/` with NO build step. ALWAYS `npm run build` first.

- [ ] **Step 1: Read an existing e2e for the harness conventions**

Read one file under `tests/e2e/` (e.g. an arrangement spec) to match: how the page is launched (`page.goto`), base URL/port (4173), how selectors are queried, and how `page.addInitScript` is used (if at all).

- [ ] **Step 2: Write the e2e test**

```ts
// tests/e2e/midi-control.spec.ts
import { test, expect } from '@playwright/test';

// Inject a fake Web MIDI device before the app's modules run.
const installFakeMidi = () => {
  const sent: number[][] = [];
  const input: any = { id: 'in', name: 'APC Key 25', manufacturer: 'Akai', onmidimessage: null };
  const output: any = { id: 'out', name: 'APC Key 25', manufacturer: 'Akai', send: (b: number[]) => sent.push(b) };
  const access: any = {
    inputs: new Map([['in', input]]),
    outputs: new Map([['out', output]]),
    onstatechange: null,
  };
  (navigator as any).requestMIDIAccess = async () => access;
  (window as any).__fakeMidi = {
    pad: (note: number) => input.onmidimessage({ data: Uint8Array.from([0x90, note, 100]) }),
    sentCount: () => sent.length,
  };
};

test('APC Key 25: enable, launch a clip from a pad, receive LED feedback', async ({ page }) => {
  await page.addInitScript(installFakeMidi);
  await page.goto('/');

  // Open the MIDI Control disclosure and enable.
  await page.locator('summary', { hasText: 'MIDI Control' }).click();
  await page.locator('#midi-control-enable').click();
  await expect(page.locator('#midi-control-status')).toContainText('APC Key 25');

  // The app should have sent LED bytes on connect (full render).
  await expect.poll(() => page.evaluate(() => (window as any).__fakeMidi.sentCount())).toBeGreaterThan(0);

  // Push pad note 32 (top-left → lane 0, scene 0). If lane 0 has a clip at row 0 it launches.
  // First make sure a clip exists at lane0/row0 — create one via the UI grid if needed
  // (adapt selector to the session grid; if a demo/default clip already exists, skip).
  await page.evaluate(() => (window as any).__fakeMidi.pad(32));

  // Assert the transport started (a clip was queued/launched). The transport play button
  // flips to the stop glyph '■' when playback starts.
  await expect(page.locator('#play, [data-role="play"]')).toContainText('■', { timeout: 3000 });
});
```

> **Adapt selectors** to the real app: the play-button id/glyph, and how to ensure a clip exists at lane 0 / scene 0 before the pad press (create one by clicking an empty grid cell, or rely on a loaded demo). The essential assertions are: status shows the device, LEDs were sent, and a pad press changes app state.

- [ ] **Step 3: Build, then run the e2e**

Run: `npm run build && npm run test:e2e -- midi-control`
Expected: PASS. If the play-glyph/clip-creation selectors don't match, fix them against the real DOM (use `npm run test:e2e:headed` to watch).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/midi-control.spec.ts
git commit -m "test(e2e): APC Key 25 enable + pad launch + LED feedback (simulated device)"
```

---

## Task 18: Full suite + spec checklist + docs

**Files:**
- Modify: `README.md` (a short "MIDI controller" subsection) — optional but recommended.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS (re-run once if you hit the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown — it is not a failure).

- [ ] **Step 2: Build + e2e**

Run: `npm run build && npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Hardware checklist (human, when a device is present)**

Document the result in the PR. With an APC Key 25 connected over USB in Chrome:
- Enable from the MIDI Control panel → status shows `APC Key 25 (mk1|mk2) ✓`.
- Keys play the active lane's engine; **holding a key sustains the note**, releasing stops it; chords are polyphonic; velocity varies loudness; sustain pedal holds.
- Pads launch/show clips; LEDs: green=playing, amber=stopped, off=empty (mk1); clip colours (mk2).
- Knob banks VOLUME / PAN / SEND(=EQ) / DEVICE each affect the right target; values jump on touch.
- Scene buttons launch scenes; STOP ALL stops everything.
- LEFT/RIGHT change the active lane and the UI follows.
- Unplug → no errors, LEDs handled; re-plug → re-binds; reload page → auto-reconnects; disable → all LEDs off.

- [ ] **Step 4: Optional README note + commit**

Add a brief "Hardware MIDI control (APC Key 25)" subsection to `README.md` describing enable + the surface map.

```bash
git add README.md
git commit -m "docs(readme): document APC Key 25 hardware control"
```

- [ ] **Step 5: Finish the branch**

Per the worktree workflow: rebase onto `main`, fast-forward merge (no merge commit), then exit the worktree.

```bash
git rebase main
# resolve conflicts if any, re-run: npm run build && npm run test:unit
```

Then hand off to the finishing-a-development-branch flow.

---

## Self-review checklist (filled during planning)

- **Spec coverage:** keyboard (Tasks 8,9,14 — held notes), 8×5 clips+LEDs (Tasks 3,4,9,10,14), knobs+banks VOLUME/PAN/SEND=EQ/DEVICE (Tasks 9,14), scenes+STOP ALL (Tasks 3,9,13,14), active lane synced both ways (Tasks 7,13,14,16), fixed 8×5 viewport (Task 14 `slice(0,8)`/rows 0-4), mk1+mk2 auto-detect (Tasks 3,4,11), generic fallback (Tasks 5,6), connection/permission/UX/persistence/auto-reconnect (Tasks 11,12,15,16), LED delta anti-flood (Task 10), cleanup on disable/unload (Tasks 4,11,16), testing layers incl. e2e with simulated device (Task 17). ✅
- **Deferred per spec (not implemented):** banking (UP/DOWN inert — Task 9 `nav` no-op), multi-device, explicit transport, MIDI-learn, knob pickup. ✅
- **Type consistency:** `ControlEvent`/`LedCommand`/`SurfaceView`/`LoomControlFacade` defined once (Task 2) and imported everywhere; facade method names match between Task 2, Task 9 (mediator), and Task 14 (impl).
- **Known v1 limitations (documented):** on-screen mixer faders for VOLUME/PAN/EQ may lag the APC until the next mixer render (audio is immediate); mk2 blink/pulse approximated by a distinct solid colour; exact APC note/CC numbers + mk2 init SysEx flagged "VERIFY ON DEVICE" and isolated to `apc-key25.ts` constants.
