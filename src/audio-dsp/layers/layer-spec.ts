// What a LAYERS voice is made of, and the two rules that decide which layers a
// note reaches.
//
// A layer is another engine inside this one: its own instrument, its own params,
// its own slice of the keyboard. Two ways to pick one, and they exist for two
// different players:
//
//  - by ZONE, when a person is playing. Bass below middle C, pad above it, and
//    a note lands wherever it falls.
//  - by INDEX, when something else already knows. A note that carries a layer
//    number goes there and nowhere else, whatever its pitch.
//
// The index is why this instrument can be driven by a crossfade between loops
// without knowing that crossfades exist: it is told the layer, it does not ask
// why. Zone is the default; the index is an override, never a second rule that
// has to agree with the first.
//
// Pure: no registry, no AudioContext, no worklet globals.

import type { ParamBag, ParamIndex } from '@loom/plugin-sdk';

/** The most layers one lane can hold. Four because that is what the widest
 *  arrangement needs (a square of loops), and because every layer is a whole
 *  engine — the cost of a fifth is another synth per note, not another number. */
export const MAX_LAYERS = 4;

export interface LayerSpec {
  /** The engine this layer plays. Empty means the layer is off — a slot the
   *  user has not filled, which must cost nothing rather than pick a default. */
  engineId: string;
  /** Inclusive MIDI zone. A layer that spans the whole keyboard is 0..127. */
  lo: number;
  hi: number;
  /** 0..1. The weave's position moves these; so does a fader by hand. */
  gain: number;
  /** Which preset of `engineId` this slot is on, by name.
   *
   *  A LABEL, not the sound: the sound is the layer's params and they are what
   *  actually plays. This exists because without it the slot's dropdown had no
   *  selected state and always read "— pick —", so a rack built by recalling
   *  two presets showed neither of them and looked empty — reported exactly
   *  that way after a lane was converted.
   *
   *  Absent means "no preset chosen", which is honest for a slot whose knobs
   *  were turned by hand rather than recalled. */
  presetName?: string;
}

export const emptyLayer = (): LayerSpec => ({ engineId: '', lo: 0, hi: 127, gain: 1 });

/** A stored rack read as exactly MAX_LAYERS slots, gaps filled.
 *
 *  ONE implementation because both sides need it and they must agree on what an
 *  absent slot means: the host reads it to draw the tabs and to post the rack,
 *  the worklet reads it off a message that may have come from another build.
 *  Two copies of this rule is two answers to "what is slot 3 when nobody set
 *  it", and the disagreement would be silent. */
export function readRack(stored: readonly Partial<LayerSpec>[] | undefined): LayerSpec[] {
  const raw = Array.isArray(stored) ? stored : [];
  return Array.from({ length: MAX_LAYERS }, (_, i) => ({ ...emptyLayer(), ...raw[i] }));
}

/** Which layers this note should sound on.
 *
 *  An out-of-range index selects NOTHING rather than falling back to the zones.
 *  Silence is a bug you find; a note that quietly plays on the wrong instrument
 *  is one you ship. */
export function pickLayers(
  layers: readonly LayerSpec[], midi: number, layerIndex?: number,
): number[] {
  const live = (i: number) => i >= 0 && i < layers.length && layers[i].engineId !== '';

  if (layerIndex !== undefined) {
    if (live(layerIndex)) return [layerIndex];
    // Out of RANGE is a corrupt message and still plays nothing: silence is a
    // bug you find, a note on the wrong instrument is one you ship.
    if (layerIndex < 0 || layerIndex >= layers.length) return [];
    // In range but the slot is EMPTY is a different thing entirely — it is the
    // ordinary state of a rack the user has not finished filling, and it must
    // not be silence. Two loops and one instrument means both loops play on
    // that instrument; four loops and two means they share out. The routing
    // goes as far as the rack can and no further.
    //
    // Found by hitting it: a LAYERS lane with only slot 1 filled went dead at
    // the right-hand end of its crossfade, with nothing on screen saying why.
    const filled: number[] = [];
    for (let i = 0; i < layers.length; i++) if (live(i)) filled.push(i);
    return filled.length === 0 ? [] : [filled[layerIndex % filled.length]];
  }

  const out: number[] = [];
  for (let i = 0; i < layers.length; i++) {
    if (!live(i)) continue;
    if (midi >= layers[i].lo && midi <= layers[i].hi) out.push(i);
  }
  return out;
}

/** The prefix a layer's params wear in the LANE's vocabulary.
 *
 *  A lane declares `l0.filter.cutoff`, and the engine inside layer 0 only ever
 *  knew it as `filter.cutoff`. Prefixing rather than sharing is what lets two
 *  layers run the same engine with different settings — the obvious
 *  alternative, one bag for all, makes layer 2 a copy of layer 1 forever. */
export const layerPrefix = (i: number) => `l${i}.`;

/** The lane's bag as one layer's engine expects to read it. */
export function subBag(bag: ParamBag, i: number): ParamBag {
  const pre = layerPrefix(i);
  const out: ParamBag = {};
  for (const k in bag) {
    if (k.startsWith(pre)) out[k.slice(pre.length)] = bag[k];
  }
  return out;
}

/** The lane's slot numbering as one layer's engine expects to resolve it.
 *
 *  The VALUES array is not copied — it is the lane's own, mutated in place as
 *  knobs move. Only the naming is translated, which is what keeps a layer's
 *  knobs live on a note that is already sounding. */
export function subIndex(index: ParamIndex, i: number): ParamIndex {
  const pre = layerPrefix(i);
  const slot: Record<string, number> = {};
  for (const k in index.slot) {
    if (k.startsWith(pre)) slot[k.slice(pre.length)] = index.slot[k];
  }
  return { slot, length: index.length };
}
