// src/app/plugin-bootstrap.ts
import { registerPlugin } from '../plugins/registry';
import { synthEngineAsPlugin } from '../plugins/synth-engine-adapter';
import { getEngine } from '../engines/registry';
import type { PluginFactory } from '../plugins/types';
import { tb303Plugin } from '../engines/tb303';
import { subtractivePlugin } from '../engines/subtractive';
import { fmPlugin } from '../engines/fm';
import { wavetablePlugin } from '../engines/wavetable';

// Force-evaluate engine modules so they self-register in the legacy engine
// registry; bootstrapPlugins() then re-wraps them as plugins.
import '../engines/tb303';
import '../engines/subtractive';
import '../engines/fm';
import '../engines/wavetable';
import '../engines/karplus';
import '../engines/drums-engine';

/** Register every built-in plugin. Call once at app start, BEFORE
 *  `createAudioGraph()` (because some downstream code resolves plugins
 *  during graph construction). The `extras` parameter is unused today —
 *  it's the seam where phase 2 (runtime-loaded plugins) hooks in. */
export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  // Native plugin exports (phase 1).
  registerPlugin(tb303Plugin);
  registerPlugin(subtractivePlugin);
  registerPlugin(fmPlugin);
  registerPlugin(wavetablePlugin);

  // Synth engines via the transitional adapter. Tasks 7–12 replace each
  // line with a native plugin export.
  for (const id of ['karplus', 'drums-machine']) {
    const engine = getEngine(id);
    if (engine) registerPlugin(synthEngineAsPlugin(engine));
  }
  // FX + modulator plugins (added in later phases) live here too.
  for (const p of extras) registerPlugin(p);
}
