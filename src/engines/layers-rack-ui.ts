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
import type { EngineUIContext, SynthEngine } from './engine-types';
import type { SessionLane } from '../session/session';
import { LAYERS_ENGINE_ID, laneLayers } from './layers-engine';
import { layerPrefix, MAX_LAYERS, type LayerSpec } from '../audio-dsp/layers/layer-spec';
import { getCachedPresets } from '../presets/preset-loader';
import { commitParamForLane } from './engine-param-commit';

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
): boolean {
  if (!deps || !lane || lane.engineId === LAYERS_ENGINE_ID) return false;

  const slot = { engineId: lane.engineId, lo: 0, hi: 127, gain: 1, presetName };
  const rack: LayerSpec[] = [{ ...slot }, { ...slot }];

  const params = lane.engineState?.params;
  if (params) {
    const carried: Record<string, number> = { ...params };
    for (const [id, v] of Object.entries(params)) {
      // Only the engine's OWN params. A strip param (`bus.level`) belongs to the
      // desk, not to the patch, and prefixing one would invent `l0.bus.level`,
      // which nothing reads.
      if (id.startsWith('bus.') || id.startsWith('l0.') || id.startsWith('l1.')) continue;
      carried[`${layerPrefix(0)}${id}`] = v;
      carried[`${layerPrefix(1)}${id}`] = v;
    }
    lane.engineState = { ...lane.engineState, params: carried };
  }

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
 *  melodic lane allowed to be", and asking it is the whole point: it already
 *  drops the audio channel and the pad-editor engines. Building the list here
 *  from `listEngines` — which is what this did first — offered the Sampler and
 *  the drum machine, and NEITHER is reachable from the worklet's renderer
 *  registry: they run in processors of their own. A slot holding one would have
 *  been silently skipped at spawn, which reads as a broken instrument.
 *
 *  Excluding LAYERS itself is a separate rule and not tidiness: a LAYERS inside
 *  a LAYERS would build its own sub-engines at spawn with nothing bounding the
 *  depth — one rack pointing at itself is an infinite tower of synths inside the
 *  audio callback. */
function slotChoices() {
  const allowed = new Set(melodicSynthEngineIds());
  return listEngines('polyhost')
    .filter((e) => e.id !== LAYERS_ENGINE_ID && allowed.has(e.id));
}

/** Recall a preset INTO one layer.
 *
 *  The preset is that engine's own, written under this layer's prefix — which is
 *  what makes "303 · Acid Line on layer 1, Wave · Glass Pad on layer 2" mean
 *  what it looks like. Through commitParamForLane, so the values mirror into the
 *  lane's engineState and survive a reload; writing setBaseValue alone is how
 *  four earlier builders threw the user's edits away. */
function applyLayerPreset(
  engine: SynthEngine, ctx: EngineUIContext, i: number, engineId: string, presetName: string,
): void {
  const preset = getCachedPresets(engineId).find((p) => p.name === presetName);
  if (!preset) return;
  const pre = layerPrefix(i);
  for (const [id, value] of Object.entries(preset.params as Record<string, number>)) {
    if (typeof value === 'number') commitParamForLane(engine, ctx.sessionState, ctx.laneId, `${pre}${id}`, value);
  }
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
            applyLayerPreset(engine, ctx, open, layer.engineId, name);
            // Remember WHICH one, or the dropdown falls back to "— pick —" on
            // the next repaint and the slot reads as empty while playing the
            // sound it just recalled.
            //
            // Written STRAIGHT to the stored rack, never through setRack: that
            // door swaps the lane's engine, which rebuilds it — and rebuilding
            // it here would throw away the preset's params one line after they
            // were written. Reported as changing a layer's preset leaving the
            // sound exactly as it was.
            //
            // Rebuilding to store a LABEL is wrong on its own terms anyway. The
            // sound is the params; this is the name of where they came from.
            if (lane) lane.engineState = {
              ...lane.engineState,
              layers: rack.map((l, k) => (k === open ? { ...l, presetName: name } : l)),
            };
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
