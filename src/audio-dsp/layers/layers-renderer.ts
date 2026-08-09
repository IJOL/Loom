// One LAYERS voice: several engines rendering the same note, summed.
//
// It is the first renderer that builds other renderers. That is only possible
// because a renderer is reached through a registry lookup inside the worklet, so
// this file needs no knowledge of which engines exist — including plugin ones
// that registered after it was written.
//
// The sum is deliberately plain. Each layer renders its own sample and is scaled
// by its gain; there is no compensation, no soft clip, no normalisation by the
// number of live layers. Four layers at gain 1 are four times as loud, and that
// is the honest reading of what the user asked for — a hidden divide-by-N would
// make a fader that visibly says 1.0 quietly mean 0.25.

import type { NoteSpec, ParamBag, ParamIndex, VoiceModOffsets, VoiceRenderer } from '@loom/plugin-sdk';
import { slotOf } from '@loom/plugin-sdk';
import { createRenderer, hasRenderer } from '../renderer-registry';
import { pickLayers, subBag, subIndex, layerPrefix, type LayerSpec } from './layer-spec';

interface Live {
  render: VoiceRenderer;
  /** The rack's own figure, used until — and only until — the lane's live array
   *  arrives. A voice spawned before `setLiveValues` still has to sound. */
  gain: number;
  layer: number;
  /** Slot of this layer's `gain` in the lane's live values, resolved once in
   *  setLiveValues. -1 when the lane does not declare it, which is the ordinary
   *  case for a renderer built outside a LAYERS lane. */
  gainSlot: number;
}

export class LayersRenderer implements VoiceRenderer {
  private readonly live: Live[] = [];
  /** The lane's live values, kept by reference so a gain change reaches a note
   *  already sounding. Absent until the host hands them over. */
  private values: Float64Array | undefined;

  constructor(
    note: NoteSpec,
    params: ParamBag,
    sampleRate: number,
    layers: readonly LayerSpec[],
    /** Set when something already knows which layer this note belongs to — a
     *  crossfade between loops, a MIDI channel split, a note-FX. Absent means
     *  the zones decide. */
    layerIndex?: number,
  ) {
    for (const i of pickLayers(layers, note.midi, layerIndex)) {
      const engineId = layers[i].engineId;
      // A layer naming an engine that is not installed is SKIPPED, not fatal:
      // the rest of the voice still sounds, exactly like a missing insert. A
      // throw here would take the whole lane down over one absent plugin.
      if (!hasRenderer(engineId)) continue;
      this.live.push({
        render: createRenderer(engineId, note, subBag(params, i), sampleRate),
        gain: layers[i].gain,
        layer: i,
        gainSlot: -1,
      });
    }
  }

  renderSample(t: number, modOffsets?: VoiceModOffsets): number {
    const v = this.values;
    let sum = 0;
    for (const l of this.live) {
      // The LIVE gain when the lane numbers one, the rack's otherwise. Reading
      // the rack alone is what made a layer's fader move the next note and not
      // the one sounding — and a crossfade between two layers is precisely this
      // number moving under a held chord.
      const gain = v && l.gainSlot >= 0 ? v[l.gainSlot] : l.gain;
      sum += l.render.renderSample(t, modOffsets) * gain;
    }
    return sum;
  }

  noteOff(t: number): void {
    for (const l of this.live) l.render.noteOff(t);
  }

  /** Each layer resolves its slots through a TRANSLATED index over the lane's
   *  own values array. The array is shared, not copied, so a knob turn reaches
   *  a note that is already sounding — the same contract every other engine
   *  keeps, and the one `live-params.dsp.test.ts` walks the registry to check. */
  setLiveValues(values: Float64Array, index: ParamIndex): void {
    this.values = values;
    for (const l of this.live) {
      // Resolved ONCE, here, exactly as the contract asks — renderSample never
      // looks a name up.
      l.gainSlot = slotOf(index, `${layerPrefix(l.layer)}gain`);
      l.render.setLiveValues?.(values, subIndex(index, l.layer));
    }
  }

  /** Done only when every layer is. A voice retired while its longest release
   *  is still ringing cuts that tail off mid-decay, which is a click. */
  get done(): boolean {
    return this.live.every((l) => l.render.done);
  }
}
