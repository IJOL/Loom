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
  // live capture (loop-record)
  startCapture(mode: 'merge' | 'replace'): void;
  stopCapture(): void;
  isCapturing(): boolean;
  canCapture(): boolean;   // MIDI enabled AND a note-capable destination exists
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
