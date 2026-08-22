// The layer strip: four tabs, and whichever one is open shows THAT engine's own
// page — its instrument, its preset, its knobs under their own names.
//
// The first attempt invented a parallel interface: every layer's knobs relabelled
// "1 Cutoff", "2 Cutoff", all four stacked at once, and no preset anywhere. That
// was wrong twice over. A layer is an instrument, so it gets an instrument's
// page — the same builder, the same labels, the same preset dropdown a lane of
// that engine shows. And four instruments' worth of knobs on screen at once is
// not a page, it is a wall.
//
// The prefix (`l0.cutoff`) stays in the DATA, because one lane owns one param
// array and two layers of the same engine must not collide. It just never
// reaches the user's eye.

import { html, render } from 'lit-html';
import { listEngines } from './registry';
import { melodicSynthEngineIds } from './engine-selector-ui';
import { isWorkletHosted } from '../plugins/capabilities';
import type { EngineUIContext, SynthEngine } from './engine-types';
import type { SessionLane } from '../session/session';
import { LAYERS_ENGINE_ID, LAYERS_DEFAULT_MODULATORS, laneLayers } from './layers-engine';
import { layerPrefix, MAX_LAYERS, readRack, type LayerSpec } from '../audio-dsp/layers/layer-spec';
import { rackNormalises } from './layers-engine';
import { getCachedPresets } from '../presets/preset-loader';
import { commitParamForLane } from './engine-param-commit';
import { prefixModulators, replaceLayerModulators } from './layer-modulators';
import type { ModulatorState } from '../modulation/types';

export interface LayersRackDeps {
  /** Write the rack to the lane and rebuild its engine. The host owns both —
   *  this file only knows which slot the user pointed at. */
  setRack: (laneId: string, layers: LayerSpec[]) => void;
  /** Repaint the lane's editor after a change that only affects what is drawn. */
  repaint: (laneId: string) => void;
}

let deps: LayersRackDeps | undefined;

/** Wired once at boot. Absent — in a fixture with no session — leaves the
 *  controls inert rather than throwing on the first change. */
export function wireLayersRack(d: LayersRackDeps): void { deps = d; }

/** Turn an ordinary lane into a LAYERS lane holding its own instrument twice.
 *
 *  Doing it by hand is five steps — swap the engine, fill slot 0, fill slot 1,
 *  set both zones, recall two presets — and the first four are the same four
 *  every time. This is those four.
 *
 *  BOTH slots get the lane's current engine, over the whole keyboard. Two
 *  full-range slots is what makes a note reach both instruments rather than
 *  being split by pitch, and that is the arrangement the SOUND fader balances.
 *
 *  The lane's existing sound is copied into both slots rather than reset. A
 *  layer's params wear its own prefix (`l0.cutoff`), so converting without
 *  copying would silently return the lane to factory defaults — the user would
 *  hear their patch vanish and have nothing to blame it on. Starting identical
 *  is also the honest default: the fader does nothing until slot 1 is given a
 *  different preset, which is a choice this function has no business making.
 *
 *  Returns false when there is nothing to convert — no session wired, no such
 *  lane, or a lane that is already layered. */
export function convertLaneToLayers(
  lane: SessionLane | undefined,
  /** Which preset the lane is showing, so both slots can say so. Resolved by
   *  the caller because "what preset is this lane on" has three answers in this
   *  codebase and no owner (see REMAINING-WORK) — inventing a fourth here would
   *  make that worse rather than expose it. */
  presetName?: string,
  /** The lane's LIVE patch — every param its engine declares, read off the
   *  engine — supplied by the caller because only it holds the lane's engine.
   *
   *  `engineState.params` is not the same thing and using it was the bug: it is
   *  a MIRROR OF EDITS, so it holds what has been written since the lane was
   *  built and nothing else. A lane sounding a preset applied at boot has an
   *  almost empty one, so the copy carried almost nothing and the converted
   *  lane came up on factory defaults — reported as "suena totalmente diferente
   *  y el preset es el mismo".
   *
   *  Falls back to the mirror when no engine is available, which is what a
   *  fixture with no audio graph has. */
  patch?: Record<string, number>,
  /** The lane's LIVE modulators, read off its engine — its envelopes, which are
   *  not params and so are not in `patch`. Supplied by the caller for the same
   *  reason and with the same fallback. */
  mods?: ModulatorState[],
  /** Engines for the slots AFTER the first, when the rack is being built as a
   *  morph rather than as a blank to fill by hand. Slot 0 always holds the
   *  lane's own instrument, carrying its patch; these are the ones you cross
   *  towards. Absent ⇒ the old two slots, both the lane's own engine. */
  spread?: readonly string[],
): boolean {
  if (!deps || !lane || lane.engineId === LAYERS_ENGINE_ID) return false;

  // Slot 1 arrives SILENT, and that is the whole difference between a rack you
  // can work with and one you cannot.
  //
  // Both slots at unity was the obvious reading and it is wrong twice. The lane
  // doubles in level the moment it is converted, which is not what "convert"
  // should mean. And worse, you then hear both instruments at once for ever:
  // recall a preset into one and the other keeps playing the old sound at full
  // level on top of it, so the change is half-masked and reads as nothing
  // happening at all — reported exactly that way.
  //
  // Silent, converting is inaudible, giving slot 2 a preset is a decision you
  // make deliberately, and raising it — by hand or with the SOUND fader — is
  // the crossfade this was built for.
  const own = { engineId: lane.engineId, lo: 0, hi: 127, presetName };
  const rack: LayerSpec[] = spread && spread.length > 0
    ? [
        { ...own, gain: 1 },
        // A slot holding the lane's OWN engine records the lane's preset too.
        // Without it a duplicated slot plays that very sound while its dropdown
        // reads "— pick —", which is the label/sound split this file already
        // fixed once for `recallLayerPreset`.
        ...spread.slice(0, MAX_LAYERS - 1).map((engineId) => ({
          engineId, lo: 0, hi: 127, gain: 0,
          presetName: engineId === lane.engineId ? presetName : undefined,
        })),
      ]
    : [{ ...own, gain: 1 }, { ...own, gain: 0 }];

  // The live patch when the caller can read one, the mirror otherwise.
  const source = patch ?? lane.engineState?.params ?? {};
  const carried: Record<string, number> = { ...lane.engineState?.params };
  // Only into the slots holding the SAME instrument. A patch is a set of ids
  // that engine declares, so copying it under another engine's prefix writes
  // names nothing over there reads — and the slot it was meant to make sound
  // familiar is playing something else entirely anyway.
  const mine = rack.map((l) => l.engineId === lane.engineId);
  const prefixes = rack.map((_, i) => layerPrefix(i));
  for (const [id, v] of Object.entries(source)) {
    // Only the engine's OWN params. A strip param (`bus.level`) belongs to the
    // desk, not to the patch, and prefixing one would invent `l0.bus.level`,
    // which nothing reads.
    if (id.startsWith('bus.') || prefixes.some((p) => id.startsWith(p))) continue;
    rack.forEach((_, i) => { if (mine[i]) carried[`${prefixes[i]}${id}`] = v; });
  }
  // The gains as PARAMS as well as in the rack, and written AFTER the copy so
  // the loop above cannot overwrite them from an engine that happens to declare
  // its own `gain`.
  //
  // Both are needed: the rack's figure is what a voice uses until the lane's
  // live values arrive, and the param is what wins afterwards. `l1.gain`
  // defaults to 1, so a rack that said 0 alone would be overruled a fraction of
  // a second later and slot 1 would come up loud anyway.
  //
  // Unconditional — outside any "did the lane have params" branch. A lane with
  // none still has to come out of this with slot 1 silent.
  rack.forEach((_, i) => { carried[`${prefixes[i]}gain`] = i === 0 ? 1 : 0; });

  // The MODULATORS, into both slots, wearing each slot's prefix.
  //
  // This is the half that params alone could never do. Subtractive ships two
  // ADSRs — one on `amp`, one on `filter.env` — and LAYERS ships a single LFO,
  // so a lane converted without them lost its amplitude envelope (flat gain) and
  // its filter envelope (a shut filter) and came out at half the level sounding
  // like another instrument. Measured: RMS 0.044 before, 0.022 after.
  //
  // PREFIXED, never shared. A modulator at the lane's level is handed to every
  // layer unchanged, so one envelope would drive all four: two instruments could
  // never have different envelopes, and a slot would sound according to what the
  // slot beside it was given. `l0.amp` is the whole difference.
  //
  // Read from the LIVE host for the same reason the patch is —
  // `engineState.modulators` is written on save, not kept in step.
  const liveMods = mods ?? lane.engineState?.modulators ?? [];
  lane.engineState = {
    ...lane.engineState,
    params: carried,
    modulators: [
      // LAYERS' own set first: the rack's LFO belongs to the rack, and is what
      // an inserted modulator would join.
      ...LAYERS_DEFAULT_MODULATORS(),
      // Into the slots holding the same instrument, for the same reason the
      // params are: an envelope aimed at `filter.env` means nothing to an engine
      // that has no filter envelope. The other slots get theirs from the preset
      // recalled into them.
      ...rack.flatMap((_, i) => (mine[i] ? prefixModulators(liveMods, i, lane.engineId) : [])),
    ],
  };

  deps.setRack(lane.id, rack);
  return true;
}

/** Which layer's page is open, per lane. Module state because it is a VIEW
 *  preference: it must survive the lane editor being rebuilt (which happens on
 *  every knob mount) and must not be saved with the session. */
const openLayer = new Map<string, number>();

export function selectedLayer(laneId: string): number {
  return openLayer.get(laneId) ?? 0;
}

/** True for a param the layer strip should NOT draw: one belonging to a layer
 *  whose tab is closed. The open layer's params are drawn by the ordinary grid,
 *  exactly as that engine always draws them. */
export function hiddenLayerParam(laneId: string, paramId: string): boolean {
  const open = selectedLayer(laneId);
  for (let i = 0; i < MAX_LAYERS; i++) {
    if (i !== open && paramId.startsWith(layerPrefix(i))) return true;
  }
  return false;
}

/** Everything a slot can actually hold.
 *
 *  `melodicSynthEngineIds` is the host's OWN answer to "which engines is a
 *  melodic lane allowed to be", and asking it drops the audio channel and the
 *  pad-editor engines. It is NOT enough on its own, and believing it was is the
 *  bug this list shipped with: it answers by NOTE EDITOR, and the Sampler's
 *  editor is a piano roll like any melodic engine's, so the Sampler passed —
 *  and, being registered at module scope while the plugin engines arrive later
 *  over HTTP, it passed FIRST. Every rack built by the WEAVE sound control got
 *  it in slot 2. A Sampler slot cannot make a sound: it runs in a processor of
 *  its own, `hasRenderer` is false for it inside the worklet and
 *  `LayersRenderer` skips it at spawn — so the crossfade's far end was silence
 *  with a full-looking dropdown above it. Measured at the master: RMS 0.032 at
 *  the near end, 0.0020 at the far one.
 *
 *  So the real question is asked directly: is this engine's voice built inside
 *  the worklet at all. Every plugin engine answers yes by construction, and the
 *  three in-tree engines that own browser resources answer no. It is the closest
 *  the main thread can get — the renderer registry itself lives in the worklet,
 *  so a plugin that declared an engine and shipped no DSP would still slip
 *  through, and be skipped just the same.
 *
 *  Excluding LAYERS itself is a separate rule and not tidiness: a LAYERS inside
 *  a LAYERS would build its own sub-engines at spawn with nothing bounding the
 *  depth — one rack pointing at itself is an infinite tower of synths inside the
 *  audio callback. */
export function slotChoices() {
  const allowed = new Set(melodicSynthEngineIds());
  return listEngines('polyhost')
    .filter((e) => e.id !== LAYERS_ENGINE_ID && allowed.has(e.id) && isWorkletHosted(e.id));
}

/** Put a whole RACK on a lane, replacing whatever it held.
 *
 *  What recalling a layered preset needs, and the reason such a preset carries
 *  its rack at all: the saved params are the four slots' knobs, and nothing in
 *  them says which instrument each slot holds. Restore the knobs onto a rack
 *  built differently and slot 0's cutoff lands on whichever engine is in slot 0
 *  now — values that mean nothing, applied in silence.
 *
 *  Rebuilds the lane, like every rack write. The caller must therefore apply the
 *  preset's PARAMS afterwards, onto the engine that exists then: a rebuilt engine
 *  takes each param from its spec default. */
export function setLaneRack(lane: SessionLane | undefined, layers: readonly Partial<LayerSpec>[]): boolean {
  if (!deps || !lane) return false;
  deps.setRack(lane.id, readRack(layers));
  return true;
}

/** Fill this rack's EMPTY slots, in order, and say which ones were filled.
 *
 *  One write and therefore one rebuild: a lane is numbered once for its
 *  lifetime, so every change to what a slot holds rebuilds it, and doing them
 *  one at a time would rebuild the lane once per slot.
 *
 *  Filled slots are never touched — this grows a rack, it does not re-deal one.
 *  That is what makes it safe to call when a lane's control gains a dimension:
 *  the two instruments you were crossing between stay exactly where they are. */
export function fillEmptyLayerSlots(
  lane: SessionLane | undefined, engineIds: readonly string[],
): number[] {
  if (!deps || !lane || engineIds.length === 0) return [];
  const rack = readRack(lane.engineState?.layers);
  const filled: number[] = [];
  let next = 0;
  const grown = rack.map((l, i) => {
    if (l.engineId !== '' || next >= engineIds.length) return l;
    filled.push(i);
    return { ...l, engineId: engineIds[next++], lo: 0, hi: 127, gain: 0 };
  });
  if (filled.length === 0) return [];
  deps.setRack(lane.id, grown);
  return filled;
}

/** Put a different INSTRUMENT in one slot.
 *
 *  Through the same door the rack's own dropdown uses, which writes the rack and
 *  rebuilds the engine behind it — changing what a slot holds changes the lane's
 *  param numbering, and a lane's numbering is fixed for its lifetime.
 *
 *  False when there is nothing to write, so a caller can tell "not a rack" from
 *  "done". */
export function setLayerEngine(lane: SessionLane | undefined, i: number, engineId: string): boolean {
  if (!deps || !lane) return false;
  const rack = readRack(lane.engineState?.layers);
  if (i < 0 || i >= rack.length) return false;
  deps.setRack(lane.id, rack.map((l, k) => (k === i ? { ...l, engineId } : l)));
  return true;
}

// `contrastPresetName` stood here: the first preset of an engine that was not
// the one a slot already had, so that converting a lane gave its sound control
// two ENDS that differed. Both callers are gone — per user direction a rack is
// built by duplicating the lane's instrument, and what the far end holds is a
// choice made on purpose rather than one dealt for you.

/** Recall a preset INTO one layer.
 *
 *  The preset is that engine's own, written under this layer's prefix — which is
 *  what makes "303 · Acid Line on layer 1, Wave · Glass Pad on layer 2" mean
 *  what it looks like. Through commitParamForLane, so the values mirror into the
 *  lane's engineState and survive a reload; writing setBaseValue alone is how
 *  four earlier builders threw the user's edits away.
 *
 *  It records WHICH preset in the stored rack too, straight rather than through
 *  `setRack`: that door rebuilds the engine, and rebuilding here would throw away
 *  the params written a line earlier. The label and the sound are two different
 *  things and this owns both, so a caller cannot write one and forget the other.
 *
 *  The session and the lane id rather than an `EngineUIContext`: the panel's
 *  sound fader reaches this from the host, where no UI context exists, and the
 *  two fields are all it ever used. */
export function recallLayerPreset(
  engine: SynthEngine, sessionState: EngineUIContext['sessionState'], laneId: string,
  i: number, engineId: string, presetName: string,
): void {
  const preset = getCachedPresets(engineId).find((p) => p.name === presetName);
  if (!preset) return;
  const ctx = { sessionState, laneId } as EngineUIContext;
  const pre = layerPrefix(i);
  for (const [id, value] of Object.entries(preset.params as Record<string, number>)) {
    if (typeof value === 'number') commitParamForLane(engine, ctx.sessionState, ctx.laneId, `${pre}${id}`, value);
  }
  // A preset is an instrument, not a bag of numbers. Most of the ones we ship
  // carry their own envelopes — subtractive's every one of them — and applying
  // only `params` left a slot playing the previous preset's envelope with the
  // new preset's knobs. This is what makes changing a layer's preset change the
  // whole sound rather than half of it.
  //
  // Replaced rather than added: the envelope this preset does not have must go,
  // or a slot accumulates one set per preset you ever recalled into it.
  const mods = replaceLayerModulators(
    engine.modulators.serialize(), i, prefixModulators(preset.modulators ?? [], i, engineId),
  );
  engine.modulators.deserialize(mods);
  (engine as { postModulators?(): void }).postModulators?.();
  const lane = ctx.sessionState?.lanes.find((l) => l.id === ctx.laneId);
  // Straight into engineState, because nothing else mirrors a modulator set on
  // its way past — `commitParamForLane` covers params and only params.
  //
  // And the LABEL beside them: without it the slot's dropdown falls back to
  // "— pick —" on the next repaint and reads as empty while playing the sound it
  // just recalled.
  if (lane) lane.engineState = {
    ...lane.engineState,
    modulators: mods,
    layers: laneLayers(lane).map((l, k) => (k === i ? { ...l, presetName } : l)),
  };
}

export function buildLayersRack(host: HTMLElement, ctx: EngineUIContext, engine: SynthEngine): void {
  const lane = ctx.sessionState?.lanes.find((l) => l.id === ctx.laneId);
  const rack = laneLayers(lane);
  const open = selectedLayer(ctx.laneId);
  const layer = rack[open];
  const presets = layer.engineId ? getCachedPresets(layer.engineId) : [];

  const pickEngine = (engineId: string) => {
    deps?.setRack(ctx.laneId, rack.map((l, k) => (k === open ? { ...l, engineId } : l)));
  };

  // lit owns this host outright — a div created for it by buildParamUI, which
  // nothing else appends to. Sharing a container between lit and hand-built DOM
  // is the one thing that reliably breaks in this codebase.
  render(html`
    <div class="layers-strip">
      <div class="layers-tabs" role="tablist">
        ${rack.map((l, i) => html`
          <button
            type="button"
            role="tab"
            class=${`layers-tab${i === open ? ' on' : ''}${l.engineId ? '' : ' empty'}`}
            aria-selected=${i === open}
            title=${l.engineId ? `Layer ${i + 1}` : `Layer ${i + 1} — empty`}
            @click=${() => { openLayer.set(ctx.laneId, i); deps?.repaint(ctx.laneId); }}
          >${i + 1}</button>
        `)}
      </div>

      <label class="layers-normalise" title=Level every instrument in this rack against the others. Off keeps the difference between them, which is sometimes the arrangement.>
        <input
          type="checkbox"
          .checked=${rackNormalises(lane)}
          @change=${(e: Event) => {
            // Written straight onto engineState and then reposted through the
            // rack door, because the flag changes each slot's TRIM — which is
            // structural, not a param, and reaches the worklet with the rack.
            // The rack itself is handed back unchanged; what moved is what
            // `structuralFor` reads while building it.
            if (!lane) return;
            const on = (e.target as HTMLInputElement).checked;
            lane.engineState = { ...lane.engineState, layerNormalise: on };
            deps?.setRack(ctx.laneId, rack);
          }}
        />
        <span>Level the slots</span>
      </label>

      <label class="layers-field">
        <span>Instrument</span>
        <select
          aria-label=${`Instrument in layer ${open + 1}`}
          @change=${(e: Event) => pickEngine((e.target as HTMLSelectElement).value)}
        >
          <!-- Empty is a real choice, and the default: a fresh rack must not be
               four synths deep before the user has picked anything. -->
          <option value="" ?selected=${layer.engineId === ''}>— empty —</option>
          ${slotChoices().map((c) => html`
            <option value=${c.id} ?selected=${c.id === layer.engineId}>${c.name}</option>
          `)}
        </select>
      </label>

      <label class="layers-field">
        <span>Preset</span>
        <select
          aria-label=${`Preset for layer ${open + 1}`}
          ?disabled=${presets.length === 0}
          @change=${(e: Event) => {
            const name = (e.target as HTMLSelectElement).value;
            if (!name) return;
            // Sound AND label together, which is that door's whole job — the two
            // used to be written here in two steps, and the label's step carried
            // the reason they must not go through `setRack`.
            recallLayerPreset(engine, ctx.sessionState, ctx.laneId, open, layer.engineId, name);
            deps?.repaint(ctx.laneId);
          }}
        >
          <option value="" ?selected=${!layer.presetName}>${presets.length ? '— pick —' : '—'}</option>
          ${presets.map((p) => html`
            <option value=${p.name} ?selected=${p.name === layer.presetName}>${p.name}</option>
          `)}
        </select>
      </label>
    </div>
  `, host);
}
