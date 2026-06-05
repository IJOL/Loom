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
