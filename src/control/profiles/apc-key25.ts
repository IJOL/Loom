// src/control/profiles/apc-key25.ts
import type {
  ControllerProfile, ControlEvent, ParseCtx, MIDIPortInfo, SurfaceView, LedCommand, SendFn, Variant, CellState,
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

export const apcKey25: ControllerProfile = {
  id: 'apc-key25',
  label: 'Akai APC Key 25',
  detect, variantFor, parse, render, onConnect, onDisconnect,
};
