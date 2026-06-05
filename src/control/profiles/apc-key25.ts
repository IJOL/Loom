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
