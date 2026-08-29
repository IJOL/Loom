// Puts LAYERS in the worklet's renderer registry.
//
// A side-effect import, like the LFO kernel next to it, and for the same reason:
// this renderer is IN-TREE, so it belongs to the worklet's own bundle rather
// than arriving through a separately added plugin module. It is also the one
// renderer that could not be a plugin — it reaches into the registry to build
// other engines, and the plugin ABI deliberately does not open that door.

import { registerRenderer } from '../renderer-registry';
import { LayersRenderer } from './layers-renderer';
import { readRack, type LayerSpec } from './layer-spec';

/** What the host posts as this lane's structural state. */
export interface LayersStructural {
  layers: LayerSpec[];
}

/** Read the rack out of whatever arrived, filling the gaps.
 *
 *  Defensive because this crosses a thread boundary and a message from an older
 *  or newer build has to degrade to silence rather than to a throw inside the
 *  audio callback — where a throw takes the whole lane down mid-bar. */
function racksOf(structural: unknown): LayerSpec[] {
  // readRack is the ONE reading of a stored rack, shared with the host. A second
  // one here would be a second answer to "what is slot 3 when nobody set it",
  // across a thread boundary where the disagreement is silent.
  //
  // Cached per structural OBJECT: this used to run on every spawn (4 objects +
  // 8 spreads per note, on the audio thread) for a value that is constant until
  // the next `structural` message — which arrives as a fresh structured-clone
  // object, so the WeakMap key rolls over exactly when the rack changes. The
  // shared rack is read-only downstream (LayersRenderer copies what it keeps).
  if (typeof structural !== 'object' || structural === null) return EMPTY_RACK;
  let rack = rackCache.get(structural);
  if (!rack) {
    rack = readRack((structural as LayersStructural).layers);
    rackCache.set(structural, rack);
  }
  return rack;
}
const rackCache = new WeakMap<object, LayerSpec[]>();
const EMPTY_RACK = readRack(undefined);

export const LAYERS_ENGINE_ID = 'layers';

registerRenderer(LAYERS_ENGINE_ID, (note, params, sr, structural) =>
  new LayersRenderer(note, params, sr, racksOf(structural), note.layerIndex));
