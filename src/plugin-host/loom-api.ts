// The runtime handshake, main-thread half.
//
// A plugin's main.js is compiled JS that cannot import anything of ours (our
// modules are bundled and hashed), so the meeting point is a global object. The
// worklet half lives in loom-processor.ts and installs the same shape there —
// separately addModule'd worklet modules do not share module instances, so a
// global is the ONLY place both halves can meet.
import { LOOM_API_VERSION, type ComponentManifest, type EngineManifest, type RendererFactory } from '@loom/plugin-sdk';
import { registerEngine, registerEngineFactory } from '../engines/registry';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import { registerRenderer } from '../audio-dsp/renderer-registry';
import { getCachedPresets } from '../presets/preset-loader';
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import type { ModulatorState } from '../modulation/types';

/** SynthEngine.editor only distinguishes note-grid shapes (piano-roll vs
 *  drum-grid); the 'audio' clip editor is chosen independently, by
 *  isAudioClip() in clip-editor-router.ts, not by this field. A component
 *  whose capability is 'audio' still needs an editor value here, so it
 *  collapses to the note-grid default like any non-drum engine did before. */
function descriptorEditor(clipEditor: 'piano-roll' | 'drum-grid' | 'audio'): 'piano-roll' | 'drum-grid' {
  return clipEditor === 'drum-grid' ? 'drum-grid' : 'piano-roll';
}

/** @deprecated The v1 path: `plugins/karplus/main.ts` still speaks this shape
 *  (Task 7 converts it to registerComponent). It feeds the SAME door as
 *  adoptComponent so a v1 plugin is not a second-class citizen while it lasts. */
function adoptEngine(m: EngineManifest): void {
  registerEngineCapabilities(m.id, {
    clipEditor: m.clipEditor, shortLabel: m.shortLabel, outputTrim: m.outputTrim, gm: m.gm,
  }, true);
  const make = () => createDescriptorEngine({
    id: m.id,
    name: m.name,
    polyphony: m.polyphony,
    editor: descriptorEditor(m.clipEditor),
    params: m.params,
    presets: () => getCachedPresets(m.id),
    modulators: (m.modulators ?? []) as ModulatorState[],
  });
  registerEngineFactory(m.id, make);
  registerEngine(make());
}

function adoptComponent(m: ComponentManifest): void {
  registerEngineCapabilities(m.id, m.capabilities, true);
  const make = () => createDescriptorEngine({
    id: m.id,
    name: m.name,
    polyphony: m.polyphony,
    // The host owns the clip editors; the plugin only says which one it wants.
    editor: descriptorEditor(m.capabilities.clipEditor),
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
      registerComponent: (m: ComponentManifest) => adoptComponent(m),
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
  __resetCapabilities();
  installed = false;
}
