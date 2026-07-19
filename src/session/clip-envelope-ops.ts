// src/session/clip-envelope-ops.ts
// Creating a clip automation envelope. Extracted from the "+ Automation" button
// so the knob context menu can create one the same way — two copies of the
// sizing and dedupe rules would drift.

import type { SessionClip } from './session-types';
import { AUTOMATION_SUB_RES } from '../core/pattern';

/** Add a flat (0.5) envelope for `paramId`, sized to the clip's length.
 *  Returns false and changes nothing when that param already has one. */
export function addClipEnvelope(clip: SessionClip, paramId: string): boolean {
  if (!clip.envelopes) clip.envelopes = [];
  if (clip.envelopes.some((e) => e.paramId === paramId)) return false;
  const stepCount = clip.lengthBars * 16 * AUTOMATION_SUB_RES;
  clip.envelopes.push({
    paramId,
    enabled: true,
    stepped: false,
    values: Array.from({ length: stepCount }, () => 0.5),
  });
  return true;
}
