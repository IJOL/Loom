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
import { createRenderer, hasRenderer } from '../renderer-registry';
import { pickLayers, subBag, subIndex, type LayerSpec } from './layer-spec';

interface Live {
  render: VoiceRenderer;
  gain: number;
  layer: number;
}

export class LayersRenderer implements VoiceRenderer {
  private readonly live: Live[] = [];

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
      });
    }
  }

  renderSample(t: number, modOffsets?: VoiceModOffsets): number {
    let sum = 0;
    for (const l of this.live) sum += l.render.renderSample(t, modOffsets) * l.gain;
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
    for (const l of this.live) {
      l.render.setLiveValues?.(values, subIndex(index, l.layer));
    }
  }

  /** Done only when every layer is. A voice retired while its longest release
   *  is still ringing cuts that tail off mid-decay, which is a click. */
  get done(): boolean {
    return this.live.every((l) => l.render.done);
  }
}
