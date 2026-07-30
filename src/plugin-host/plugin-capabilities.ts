// The ONLY reader of plugin capabilities. Every question the host used to answer
// with `engineId === '…'` comes through here, so there is exactly one place that
// knows how a manifest maps onto host behaviour.
import { registeredPluginEngines } from './loom-api';
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';

export function outputTrimFor(engineId: string): number | undefined {
  return registeredPluginEngines().get(engineId)?.outputTrim;
}

export function shortLabelFor(engineId: string): string | undefined {
  return registeredPluginEngines().get(engineId)?.shortLabel;
}

export function pluginGmHints(): { keywords: string[]; engineId: string; priority: number }[] {
  const out: { keywords: string[]; engineId: string; priority: number }[] = [];
  for (const [id, m] of registeredPluginEngines()) {
    if (m.gm) out.push({ keywords: m.gm.keywords, engineId: id, priority: m.gm.priority });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** A plugin engine synthesises in the worklet exactly when it shipped a
 *  renderer. Nothing to keep in sync by hand. */
export function isWorkletHosted(engineId: string): boolean {
  return registeredPluginEngines().has(engineId);
}

/** What the host must multiply a PLUGIN engine's voices by: the engine's own
 *  declared balance times the synth category gain — exactly what synthTrim()
 *  computes for an in-tree engine. Undefined for an engine that is not a
 *  plugin, so callers fall back to 1 and the in-tree renderer's own
 *  multiplication stands. */
export function pluginSynthTrim(engineId: string): number | undefined {
  const t = outputTrimFor(engineId);
  return t === undefined ? undefined : t * CATEGORY_GAIN.synth;
}
