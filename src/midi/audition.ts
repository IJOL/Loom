// src/midi/audition.ts — fire-and-forget audition of a (engine, preset) pair.
//
// Used by the MIDI import UI: when the user clicks the ▶ button on a track
// row we spin up a one-shot engine instance, apply the preset, play a short
// 3-note arpeggio through the supplied output node, then dispose. No session
// or sequencer state is touched.

import { createEngineInstance } from '../engines/registry';
import type { GMMatch } from './gm-lookup';

export function auditionPreset(match: GMMatch, ctx: AudioContext, output: AudioNode): void {
  const engine = createEngineInstance(match.engineId);
  if (!engine) return;
  try { engine.applyPreset(match.presetName); } catch { /* ignore — best effort */ }
  const voice = engine.createVoice(ctx, output);
  const t0 = ctx.currentTime + 0.02;
  const step = 0.18;
  const gate = 0.15;
  for (let i = 0; i < 3; i++) {
    voice.trigger(60 + i * 2, t0 + i * step, { gateDuration: gate, velocity: 100 });
    voice.release(t0 + i * step + gate);
  }
  setTimeout(() => {
    try { voice.dispose(); } catch { /* ignore */ }
    try { engine.dispose(); } catch { /* ignore */ }
  }, (3 * step + 0.5) * 1000);
}
