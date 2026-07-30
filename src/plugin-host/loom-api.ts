// The runtime handshake, main-thread half.
//
// A plugin's main.js is compiled JS that cannot import anything of ours (our
// modules are bundled and hashed), so the meeting point is a global object. The
// worklet half lives in loom-processor.ts and installs the same shape there —
// separately addModule'd worklet modules do not share module instances, so a
// global is the ONLY place both halves can meet.
import { LOOM_API_VERSION, type EngineManifest, type RendererFactory } from '@loom/plugin-sdk';
import { registerEngine, registerEngineFactory } from '../engines/registry';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import { registerRenderer } from '../audio-dsp/renderer-registry';
import { getCachedPresets } from '../presets/preset-loader';
import type { ModulatorState } from '../modulation/types';

const pluginEngines = new Map<string, EngineManifest>();

/** Every engine manifest a plugin has registered, by engine id. The capability
 *  readers ask this; nothing else should reach for it. */
export function registeredPluginEngines(): ReadonlyMap<string, EngineManifest> {
  return pluginEngines;
}

function adoptEngine(m: EngineManifest): void {
  pluginEngines.set(m.id, m);
  const make = () => createDescriptorEngine({
    id: m.id,
    name: m.name,
    polyphony: m.polyphony,
    // The host owns the clip editors; the plugin only says which one it wants.
    editor: m.clipEditor === 'drum-grid' ? 'drum-grid' : 'piano-roll',
    params: m.params,
    presets: () => getCachedPresets(m.id),
    modulators: (m.modulators ?? []) as ModulatorState[],
  });
  registerEngineFactory(m.id, make);
  registerEngine(make());
}

let installed = false;

export function installMainThreadLoomApi(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(globalThis, 'Loom', {
    value: {
      apiVersion: LOOM_API_VERSION,
      registerEngine: (m: EngineManifest) => adoptEngine(m),
      // The main thread needs renderers too: the offline exporter runs the same
      // pure kernel here, not in the worklet.
      registerRenderer: (id: string, make: RendererFactory) => registerRenderer(id, make),
    },
    writable: false,
    configurable: true,
  });
}

/** Test-only. */
export function __resetPluginEngines(): void {
  pluginEngines.clear();
  installed = false;
}
