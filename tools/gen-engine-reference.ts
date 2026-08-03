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

import { createRenderer } from '../src/audio-dsp/renderer-registry';
import type { NoteSpec, ParamBag } from '../src/audio-dsp/types';

// Side-effect imports: the modulator components. A plugin manifest can declare
// modulators of its own, and resolving one goes through this registry — so
// without these, an engine that ships an LFO throws "unknown modulator kind:
// lfo" long before any sample is rendered.
import '../src/plugins/modulators/lfo';
import '../src/plugins/modulators/adsr';
// A plugin's renderer arrives through the Loom global instead, and that global
// is installed by importing this module — see test/plugin-dsp.ts.
import { loadPluginRenderers } from '../test/plugin-dsp';

// Re-exported so a caller that has this module already does not need to know
// where the loader lives. It walks plugins/*/plugin.json and imports the `dsp`
// of every one that declares it — four engines and a modulator today, and
// whatever lands tomorrow without this file being edited.
export { loadPluginRenderers };

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

/** Render `engineId` and return every STRIDE-th sample — a bare number[], the
 *  shape plugins/karplus/reference-render.json already uses. */
export function renderReference(engineId: string, bag: ParamBag): number[] {
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

/** A plugin's declared defaults, read from its manifest. */
export async function pluginDefaultParams(pluginId: string): Promise<ParamBag> {
  const manifest = (await import(`../plugins/${pluginId}/plugin.json`)).default as {
    components: { params: { id: string; default: number }[] }[];
  };
  const bag: ParamBag = {};
  for (const p of manifest.components[0].params) bag[p.id] = p.default;
  return bag;
}

/** Render `engineId` and return its reference. Every engine is a plugin now, so
 *  there is one path: load the installed plugin renderers, then render at the
 *  defaults its own manifest declares. The IN_TREE branch this used to open
 *  with is gone with the last built-in melodic engine. */
export async function referenceFor(engineId: string): Promise<number[]> {
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
