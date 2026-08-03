// src/engines/engine-params.ts
// Canonical per-engine param schema. Drives knob construction, automation
// registry ids, modulator destination ids, and voice AudioParam lookup.
// One id per param, used in every layer.

import type { EngineParamSpec } from '@loom/plugin-sdk';

// The shape is owned by @loom/plugin-sdk: it is what a plugin's manifest
// declares, so the host cannot honour a field the SDK does not publish — that
// asymmetry is exactly what kept curve/color/drawnBy out of reach of a plugin.
// Re-exported under the same name so no importer in src/ changes.
//
// Two rules that live on the host side and are not visible from the type:
//   * A discrete param ALWAYS renders through createSelectControl, never a
//     knob — see engine-param-grid.ts's header for the full rule (≤4 options
//     draw a radio strip, more draw a native <select>, and `selectStyle:
//     'dropdown'` forces the <select> at any count).
//   * `drawnBy` NEVER means "drawn nowhere": a sound param with no control at
//     all is a bug. 'mixer' is RESERVED and set by no spec yet — strip params
//     are still filtered by `isStripParamId` inside the grid.
export type { EngineParamSpec } from '@loom/plugin-sdk';

export function isContinuous(s: EngineParamSpec): boolean {
  return s.kind === 'continuous';
}

export function isDiscrete(s: EngineParamSpec): boolean {
  return s.kind === 'discrete';
}

export function validateSpec(s: EngineParamSpec): void {
  if (!s.id || !s.id.length) throw new Error(`spec.id required`);
  if (!s.label) throw new Error(`spec.label required: ${s.id}`);
  if (s.kind === 'continuous') {
    if (!(s.max > s.min)) throw new Error(`spec ${s.id} must satisfy max > min`);
  } else {
    if (!s.options || s.options.length < 2) throw new Error(`spec ${s.id} (discrete) needs at least 2 options`);
  }
}
