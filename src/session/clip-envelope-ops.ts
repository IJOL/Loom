// src/session/clip-envelope-ops.ts
// Creating a clip automation envelope. Extracted from the "+ Automation" button
// so the knob context menu can create one the same way — two copies of the
// sizing and dedupe rules would drift.

import type { SessionClip } from './session-types';
import type { TimeSignature } from '../core/meter';
import { envelopeValueLength } from '../core/clip-envelope-length';

/** Add a flat (0.5) envelope for `paramId`, sized to the clip's length in the
 *  session meter. Returns false and changes nothing when that param already has
 *  one. `meter` is optional only so a caller that genuinely has no session (a
 *  fixture) still reads as 4/4 — every production caller passes the real one, or
 *  the envelope it creates would not line up with the clip it belongs to. */
export function addClipEnvelope(
  clip: SessionClip, paramId: string, meter?: TimeSignature,
): boolean {
  if (!clip.envelopes) clip.envelopes = [];
  if (clip.envelopes.some((e) => e.paramId === paramId)) return false;
  clip.envelopes.push({
    paramId,
    enabled: true,
    stepped: false,
    values: Array.from({ length: envelopeValueLength(clip.lengthBars, meter) }, () => 0.5),
  });
  return true;
}
