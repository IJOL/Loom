// Loading the DSP half of a plugin engine inside a unit test or a tool.
//
// A plugin's `dsp.ts` calls `Loom.registerRenderer` at module scope — that IS
// the ABI — so the global has to exist BEFORE that module is evaluated. This
// file installs it as its own module side effect, and the stub FORWARDS into
// the host's renderer registry. Two consequences worth knowing:
//
//   - `import '../../test/plugin-dsp'` placed ABOVE `import '.../plugins/fm/dsp'`
//     is enough. ESM evaluates imported modules in source order, so no
//     `vi.hoisted` dance is needed; a static plugin-dsp import registers the
//     renderer exactly as `import './fm-renderer'` used to.
//   - `createRenderer('fm', …)` then answers for a plugin engine through the
//     same registry it answers for an in-tree one, which is what lets the
//     cross-engine .dsp tests keep citing every engine by id.
//
// Only the DSP half is installed here — a renderer, not a descriptor. A test
// that needs the engine's PARAMS wants test/plugin-fixtures.ts instead (or the
// manifest directly); the two doors are separate on purpose, because a plugin
// ships them as separate files.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRenderer } from '../src/audio-dsp/renderer-registry';
import { registerModulatorKernel } from '../src/audio-dsp/modulator-kernels';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

// Not installMainThreadLoomApi(): that one also adopts COMPONENTS, which drags
// the preset loader and the modulator registry into files that only want a
// renderer. Keep the stub to what a dsp.ts is allowed to call — the same
// minimum every parity test asserts.
if ((globalThis as { Loom?: unknown }).Loom === undefined) {
  Object.defineProperty(globalThis, 'Loom', {
    value: { apiVersion: 1, registerRenderer, registerModulatorKernel },
    writable: true,
    configurable: true,
  });
}

/** Every installed plugin whose manifest declares a `dsp` entry point. Read off
 *  disk rather than listed here, so a plugin is covered the day it lands and not
 *  the day somebody remembers this file. */
export function pluginDspIds(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => {
      try {
        const m = JSON.parse(readFileSync(join(ROOT, e.name, 'plugin.json'), 'utf8'));
        return typeof m.dsp === 'string';
      } catch {
        return false;   // no manifest, or no dsp half — nothing to load
      }
    })
    .map((e) => e.name);
}

/** Register the renderer of every installed plugin. Dynamic on purpose: the
 *  import must happen after the Loom global above exists, and the id list comes
 *  from disk. Callers that can name the plugin statically should just
 *  `import '../../plugins/<id>/dsp'` below this module instead. */
export async function loadPluginRenderers(): Promise<void> {
  // The `.ts` is not decoration: vite's dynamic-import-vars plugin needs a file
  // extension in the static part of the specifier, and warns on every run
  // without one. tsx (which runs tools/gen-engine-reference.ts) resolves it too.
  for (const id of pluginDspIds()) await import(`../plugins/${id}/dsp.ts`);
}
