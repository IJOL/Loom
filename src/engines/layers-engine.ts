// LAYERS — an instrument made of other instruments.
//
// Four slots, each with its own engine, its own slice of the keyboard and its
// own gain. Play a low note and the bass layer answers; play a high one and the
// pad does; overlap the zones and both sound at once. One lane, one mixer strip,
// one insert chain — which is the whole reason it is an instrument rather than
// four lanes glued together.
//
// It is IN-TREE, and that needs a reason because a component that makes sound is
// supposed to be a plugin. The reason: it builds other engines out of the
// worklet's renderer registry, and the plugin ABI deliberately does not open
// that door — a plugin that could instantiate arbitrary other plugins would make
// the load report a lie. The DSP is in `audio-dsp/layers/`; this file is the
// metadata half, like every other descriptor.
//
// What lives WHERE, and why:
//   - which engine is in a slot → `lane.engineState.layers`, because an engine
//     id is not a number and a param can only carry a number.
//   - a slot's zone and gain  → ordinary params (`l0.lo`, `l0.gain`), so they
//     automate, undo and save like any other knob.
//   - a slot's own knobs      → ordinary params too, prefixed (`l0.filter.cutoff`),
//     but DECLARED per lane from whatever engine that slot holds. That is what
//     `dynamicParamsFor` is for.

import { registerEngine, registerEngineFactory, getEngineDescriptor } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import { requireModulator } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';
import { pluginSynthTrim, registerEngineCapabilities } from '../plugins/capabilities';
import { slotNormalisation } from '../audio-dsp/layers/slot-normalise';
import { presetEnergy, presetEnergyTarget } from '../presets/preset-energy-loader';
import { isStripParamId } from '../core/channel-strip-params';
import {
  MAX_LAYERS, layerPrefix, layerModTargets, readRack, type LayerSpec,
} from '../audio-dsp/layers/layer-spec';
import { buildLayersRack, hiddenLayerParam } from './layers-rack-ui';
import type { SessionLane } from '../session/session';

export const LAYERS_ENGINE_ID = 'layers';

/** A FUNCTION, not a computed constant — see DRUMS_DEFAULT_MODULATORS: this
 *  file's registerEngine runs at module scope, the same moment the lfo/adsr
 *  components register from a separate eager glob in an order nothing
 *  guarantees. */
export function LAYERS_DEFAULT_MODULATORS(): ModulatorState[] {
  return [requireModulator('lfo').defaultState('lfo1')];
}

/** The layer's own three knobs get one section; the instrument inside it keeps
 *  ITS sections, with their own titles. That is the whole point of the tabs:
 *  open layer 2 and you are looking at the Wavetable page, not at a translation
 *  of it. */
function layerGroups(): EngineParamGroup[] {
  const out: EngineParamGroup[] = [];
  for (let i = 0; i < MAX_LAYERS; i++) {
    out.push({ id: `${layerPrefix(i)}slot`, title: 'Layer' });
  }
  return out;
}

/** The three knobs every slot has, filled or not.
 *
 *  Always declared, even for an empty slot: the lane's param numbering is fixed
 *  for its lifetime, so a slot that grew its knobs only once filled would need
 *  the lane rebuilt to turn a gain down. */
function rackParams(): EngineParamSpec[] {
  const out: EngineParamSpec[] = [];
  for (let i = 0; i < MAX_LAYERS; i++) {
    const p = layerPrefix(i);
    const g = `${p}slot`;
    out.push(
      // Up to 2, not 1. At a ceiling of unity a quiet slot is already at the top
      // of its fader with nowhere to go — which is the same dead end a user hit
      // on a lane ("lo tengo al maximo" and it was still buried). The mixer's own
      // lane fader has gone above unity for exactly this reason and the weave's
      // copies it; a rack had no way to say "more of this one". Zero stays the
      // bottom, because silencing a slot is a thing you do.
      { id: `${p}gain`, label: 'Gain', kind: 'continuous', min: 0, max: 2, default: 1, group: g },
      // The zone is a pair of MIDI notes, not a range control, because the two
      // ends are independent: a stack is two layers whose zones OVERLAP, and a
      // single range widget would make that the awkward case rather than the
      // ordinary one.
      { id: `${p}lo`, label: 'Low', kind: 'continuous', min: 0, max: 127, default: 0, group: g },
      { id: `${p}hi`, label: 'High', kind: 'continuous', min: 0, max: 127, default: 127, group: g },
    );
  }
  return out;
}

export const LAYERS_PARAMS: EngineParamSpec[] = rackParams();

/** The rack as stored, padded to MAX_LAYERS. Reading it in one place means the
 *  audio side and the UI cannot disagree about what an absent slot means. */
export function laneLayers(lane: SessionLane | undefined): LayerSpec[] {
  return readRack(lane?.engineState?.layers);
}

/** Does this rack level its slots against each other?
 *
 *  Per RACK and not global, and ON unless someone says otherwise. On, because
 *  the catalogue it draws from spans 45 dB and two presets picked at random can
 *  differ by thirty — at which point the quieter slot is not quiet, it is
 *  absent. Off, because a rack is also how you stack a whisper under a lead and
 *  the difference IS the arrangement; asked for in exactly those words.
 *
 *  A rack saved before this existed has no flag and gets the levelling. That is
 *  a deliberate choice rather than an oversight: the flag says "leave my
 *  balance alone", and a rack that never had the option never expressed one. */
export function rackNormalises(lane: SessionLane | undefined): boolean {
  return (lane?.engineState as { layerNormalise?: boolean } | undefined)?.layerNormalise !== false;
}

/** Everything that scales ONE slot before its own gain fader: its engine's
 *  declared balance, its preset's declared balance, and what neither of those
 *  fixed.
 *
 *  All three ride the same field for the same reason — `trim` is derived, never
 *  saved, and travels with the rack rather than as a param. The preset's
 *  `output.trim` has to come this way because it is NOT a declared param: on an
 *  ordinary lane the host seeds it by hand for exactly that reason, while a
 *  slot's params come from the engine's spec, so `l0.output.trim` had nowhere
 *  to land and was silently dropped. Measured: LEAD Supersaw 7 declares 0.25 and
 *  played a rack at 11.90 against 2.98 on a lane — 4.000x, to three decimals. */
export function slotTrim(l: LayerSpec, normalise: boolean): number {
  const engine = pluginSynthTrim(l.engineId) ?? 1;
  const preset = presetTrimOf(l.engineId, l.presetName);
  const norm = normalise
    ? slotNormalisation(presetEnergy(l.engineId, l.presetName), presetEnergyTarget())
    : 1;
  return engine * preset * norm;
}

/** A preset's own `output.trim`, 1 when it declares none. */
function presetTrimOf(engineId: string, presetName: string | undefined): number {
  if (!presetName) return 1;
  const p = getCachedPresets(engineId).find((x) => x.name === presetName);
  const v = (p?.params as Record<string, number> | undefined)?.['output.trim'];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

/** Each filled slot's OWN engine params, wearing this slot's prefix.
 *
 *  Strip params are dropped: level, pan, the sends and the EQ belong to the
 *  lane's one mixer channel, and four layers must not offer four faders for it.
 *
 *  This is read when the lane's worklet engine is BUILT, so changing which
 *  engine sits in a slot rebuilds the lane — the same thing a plain engine swap
 *  already does, for the same reason: the param numbering is fixed for a lane's
 *  lifetime. Changing a zone or a gain does not; those are declared up front. */
export function layersDynamicParamsFor(lane: SessionLane): EngineParamSpec[] {
  const out: EngineParamSpec[] = [];
  laneLayers(lane).forEach((layer, i) => {
    if (!layer.engineId) return;
    const spec = getEngineDescriptor(layer.engineId);
    if (!spec) return;
    const p = layerPrefix(i);
    for (const s of spec.params) {
      if (isStripParamId(s.id)) continue;
      // The ID is prefixed, the LABEL is not. The prefix exists so two layers of
      // the same engine do not collide in one lane's param array; the user is
      // looking at that engine's page and its knob is called Cutoff there.
      out.push({ ...s, id: `${p}${s.id}`, group: s.group ? `${p}${s.group}` : `${p}slot` });
    }
  });
  return out;
}

/** The engine's own section titles, wearing this layer's prefix, so the open
 *  tab renders the instrument's real layout instead of one flat row. */
export function layersDynamicGroupsFor(lane: SessionLane): EngineParamGroup[] {
  const out: EngineParamGroup[] = [];
  laneLayers(lane).forEach((layer, i) => {
    if (!layer.engineId) return;
    const p = layerPrefix(i);
    for (const g of getEngineDescriptor(layer.engineId)?.groups ?? []) {
      out.push({ ...g, id: `${p}${g.id}` });
    }
  });
  return out;
}

function makeLayersDescriptor() {
  return createDescriptorEngine({
    id: LAYERS_ENGINE_ID,
    name: 'Layers',
    polyphony: 'poly',
    params: LAYERS_PARAMS,
    groups: layerGroups(),
    presets: () => getCachedPresets(LAYERS_ENGINE_ID),
    modulators: LAYERS_DEFAULT_MODULATORS,
    dynamicParamsFor: layersDynamicParamsFor,
    dynamicGroupsFor: layersDynamicGroupsFor,
    // Plain objects: this crosses the thread boundary by structured clone.
    //
    // Each slot carries its engine's own output balance. A lane gets ONE trim
    // from the allocator and LAYERS declares 1, so an engine inside a slot had
    // no way to ask for its own and played raw — subtractive asks for 0.25, so
    // a layered lane came out four times as loud as the same patch on a lane of
    // its own. Derived here rather than stored, because it belongs to the
    // engine: a plugin that revises its trim must not need every saved rack
    // rewritten.
    structuralFor: (lane) => ({
      layers: laneLayers(lane).map((l) => ({
        ...l,
        trim: l.engineId ? slotTrim(l, rackNormalises(lane)) : 1,
      })),
    }),
    // A slot's own envelopes. `amp` and `filter.env` are how an engine finds its
    // per-voice envelopes, and a lane numbers one of each — so four instruments
    // in one lane would share a single amplitude envelope, and a slot's sound
    // would depend on what the slot beside it was given. One set per slot is
    // what lets a plucked bass and a slow pad live in the same lane.
    modTargets: layerModTargets(),
    extraUI: buildLayersRack,
    // Only the open tab's instrument is drawn. Four engines' worth of knobs at
    // once is not a page, it is a wall — and it is what the first attempt did.
    hideParam: hiddenLayerParam,
  });
}

registerEngineFactory(LAYERS_ENGINE_ID, makeLayersDescriptor);
registerEngine(makeLayersDescriptor());

registerEngineCapabilities(LAYERS_ENGINE_ID, {
  clipContent: 'notes',
  shortLabel: 'layers',
  outputTrim: 1,
  harmonic: true,
  // In-tree, but it synthesises down the shared worklet path like every plugin
  // engine. Without saying so the allocator routes it to no backend at all.
  workletHosted: true,
  // Its sound is which instruments are in the rack, not a bag of numbers the
  // dice can roll — the same reason the Sampler and the drum machine have none.
  isRandomizable: false,
});
