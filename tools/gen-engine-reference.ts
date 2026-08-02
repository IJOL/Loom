// tools/gen-engine-reference.ts
// Renders one note of an engine and keeps every STRIDE-th sample: the frozen
// "this is what it sounds like" the parity tests compare against.
//
// The Karplus parity test named a `tools/gen-karplus-reference.ts` for months
// and no such file ever existed — the reference it defends was produced by
// something that was never committed. This is that tool, written once and used
// by every engine, so a reference can be REGENERATED instead of only trusted.
//
// Determinism is the whole product. Two things are pinned:
//   - `Math.random`, because a plucked string excites itself with noise (see
//     plugins/karplus/dsp.ts: `const gen = rng ?? Math.random`). Unpinned, the
//     same engine renders a different reference every run.
//   - the note and the params, which come from each engine's DECLARED defaults
//     so the reference tracks the engine's own idea of itself.

import { createRenderer, registerRenderer } from '../src/audio-dsp/renderer-registry';
import { getEngineDescriptor } from '../src/engines/registry';
import type { NoteSpec, ParamBag } from '../src/audio-dsp/types';

// Side-effect imports: every in-tree renderer self-registers on import.
import '../src/audio-dsp/tb303-renderer';
import '../src/audio-dsp/subtractive-renderer';
import '../src/audio-dsp/fm-renderer';
import '../src/audio-dsp/wavetable-renderer';
import '../src/audio-dsp/westcoast-renderer';
// Side-effect imports: the modulator components. Reading a descriptor builds its
// modulator host, which resolves every declared modulator kind through the
// registry — so without these, asking tb303 for its defaults throws
// "unknown modulator kind: lfo" long before any sample is rendered.
import '../src/plugins/modulators/lfo';
import '../src/plugins/modulators/adsr';
// Side-effect imports: the engine descriptors, which carry the param defaults.
import '../src/engines/tb303';
import '../src/engines/subtractive';
import '../src/engines/fm';
import '../src/engines/wavetable';
import '../src/engines/westcoast';

/** One of every 512 samples: enough to pin the shape, small enough to commit.
 *  Matches what plugins/karplus/reference-render.json already holds. */
export const STRIDE = 512;
export const SR = 48000;
/** 0.6 s at 48 kHz ⇒ 57 kept samples, which is what the Karplus reference has. */
export const RENDER_SEC = 0.6;

/** The note every reference is rendered from. A5-ish, half a second, accented
 *  off — one plain note, so a reference difference means the ENGINE changed. */
export const NOTE: NoteSpec = {
  midi: 57, beginSec: 0, durationSec: 0.5, velocity: 0.8, accent: false, slide: false,
};

/** The same LCG the Karplus parity test uses. Changing it invalidates every
 *  committed reference, so it is not a knob. */
function seeded(): () => number {
  let s = 12345;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** An engine's declared defaults, as a param bag. Reading them from the
 *  descriptor rather than hard-coding a bag per engine means a reference is
 *  captured at the engine's own defaults, and a default that changes shows up
 *  as a parity failure instead of hiding. */
export function defaultParams(engineId: string): ParamBag {
  const spec = getEngineDescriptor(engineId);
  if (!spec) throw new Error(`no engine descriptor registered for '${engineId}'`);
  const bag: ParamBag = {};
  for (const p of spec.params) bag[p.id] = p.default;
  return bag;
}

/** Render `engineId` and return every STRIDE-th sample — a bare number[], the
 *  shape plugins/karplus/reference-render.json already uses. */
export function renderReference(engineId: string, params?: ParamBag): number[] {
  const bag = params ?? defaultParams(engineId);
  const realRandom = Math.random;
  const rng = seeded();
  Math.random = rng;                       // pin the excitation for this render
  try {
    const r = createRenderer(engineId, NOTE, bag, SR);
    const n = Math.round(RENDER_SEC * SR);
    const kept: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = r.renderSample(i / SR);
      if (i % STRIDE === 0) kept.push(s);
    }
    return kept;
  } finally {
    Math.random = realRandom;
  }
}

/** Load the plugin engines whose DSP registers itself through the Loom global.
 *  The stub forwards into the host registry, so `renderReference` treats a
 *  plugin engine and an in-tree one through exactly one code path. */
export async function loadPluginRenderers(): Promise<void> {
  (globalThis as unknown as { Loom?: unknown }).Loom = {
    apiVersion: 1,
    registerRenderer,
    registerComponent: () => { /* the descriptor is read from plugin.json below */ },
  };
  await import('../plugins/karplus/dsp');
}

/** A plugin's declared defaults, read from its manifest. */
export async function pluginDefaultParams(pluginId: string): Promise<ParamBag> {
  const manifest = (await import(`../plugins/${pluginId}/plugin.json`)).default as {
    components: { params: { id: string; default: number }[] }[];
  };
  const bag: ParamBag = {};
  for (const p of manifest.components[0].params) bag[p.id] = p.default;
  return bag;
}

/** Engines whose renderer lives in the tree. Anything else is looked for as a
 *  plugin under plugins/<id>/. */
const IN_TREE = new Set(['tb303', 'subtractive', 'fm', 'wavetable', 'westcoast']);

/** Render `engineId` and return its reference, resolving the params from
 *  wherever that engine declares them. */
export async function referenceFor(engineId: string): Promise<number[]> {
  if (IN_TREE.has(engineId)) return renderReference(engineId);
  await loadPluginRenderers();
  return renderReference(engineId, await pluginDefaultParams(engineId));
}

// ── CLI: npx tsx tools/gen-engine-reference.ts <engineId> --out <path> ───────
// Kept in the same file as the renderer on purpose: a generator whose CLI and
// whose library half can drift is a generator that writes a reference the tests
// cannot reproduce.
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/gen-engine-reference.ts');
if (invokedDirectly) {
  const [, , engineId, ...rest] = process.argv;
  const outAt = rest.indexOf('--out');
  const out = outAt !== -1 ? rest[outAt + 1] : undefined;
  if (!engineId || !out) {
    console.error('usage: npx tsx tools/gen-engine-reference.ts <engineId> --out <path>');
    process.exit(2);
  }
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const samples = await referenceFor(engineId);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(samples)}\n`);
  console.log(`${engineId}: ${samples.length} samples -> ${out}`);
}
