// The runtime handshake, main-thread half.
//
// A plugin's main.js is compiled JS that cannot import anything of ours (our
// modules are bundled and hashed), so the meeting point is a global object. The
// worklet half lives in loom-processor.ts and installs the same shape there —
// separately addModule'd worklet modules do not share module instances, so a
// global is the ONLY place both halves can meet.
import { LOOM_API_VERSION, type ComponentManifest, type ModLiteLike, type RendererFactory } from '@loom/plugin-sdk';
import { registerEngine, registerEngineFactory, unregisterEngine } from '../engines/registry';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import { registerRenderer } from '../audio-dsp/renderer-registry';
import { registerModulatorKernel } from '../audio-dsp/modulator-kernels';
import { getCachedPresets } from '../presets/preset-loader';
import { registerEngineCapabilities, unregisterEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import { registerModulator, unregisterModulator, type ModulatorComponent } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';

/** Undoes exactly what one adopt call just registered — the rollback a
 *  failed plugin needs so it never half-installs. See adoptComponents. */
type Undo = () => void;

function adoptEngine(m: ComponentManifest & { kind: 'engine' }): Undo {
  registerEngineCapabilities(m.id, m.capabilities, true);
  // editor is NOT passed here: createDescriptorEngine derives it from the
  // capability (defaultNoteView) just registered above, through the same
  // door a built-in engine goes through — one datum, one owner.
  const make = () => createDescriptorEngine({
    id: m.id,
    name: m.name,
    polyphony: m.polyphony,
    params: m.params,
    // Carried exactly like `params`: a manifest that declares no groups still
    // gets the pre-groups fallback (one row per raw group string), the same
    // as a built-in engine that never adopted the table.
    groups: m.groups,
    presets: () => getCachedPresets(m.id),
    modulators: (m.modulators ?? []) as ModulatorState[],
  });
  registerEngineFactory(m.id, make);
  const undo = () => {
    unregisterEngine(m.id);
    unregisterEngineCapabilities(m.id);
  };
  try {
    // make() runs createDescriptorEngine synchronously, right here — a
    // manifest that reached this point already passed validatePluginManifest,
    // so nothing in-tree makes this throw today. It is still wrapped: this
    // function must be atomic (fully registered or fully absent) for
    // adoptComponents's own loop-rollback to have anything correct to undo.
    registerEngine(make());
  } catch (e) {
    undo();
    throw e;
  }
  return undo;
}

function adoptModulator(m: ComponentManifest & { kind: 'modulator' }): Undo {
  const component: ModulatorComponent = {
    id: m.id,
    name: m.name,
    driver: m.modulator.driver,
    scopes: m.modulator.scopes,
    idPrefix: m.modulator.idPrefix,
    params: m.params,
    defaultState: (id) => ({
      id, kind: m.id, enabled: true, connections: [],
      scope: m.modulator.scopes[0],
      params: Object.fromEntries(m.params.map((p) => [p.id, p.default])),
    }),
    // A plugin modulator's real signal travels the worklet kernel
    // (registerModulatorKernel), not Web Audio — only FX params ride the
    // ModulatorVoice/AudioNode road, and opening that to plugins is later
    // work. This voice is a silent placeholder so the host's per-lane bind
    // (which calls createVoice for every modulator unconditionally) has a
    // real AudioNode to connect and dispose, with nothing to say.
    createVoice: (ctx) => {
      const dc = ctx.createConstantSource();
      dc.offset.value = 0;
      dc.start();
      return {
        output: dc,
        trigger: () => {},
        release: () => {},
        dispose: () => { try { dc.stop(); } catch { /* already stopped */ } dc.disconnect(); },
        currentValue: () => 0,
      };
    },
  };
  registerModulator(component);
  return () => unregisterModulator(m.id);
}

function adoptComponent(m: ComponentManifest): Undo {
  if (m.kind === 'modulator') return adoptModulator(m);
  return adoptEngine(m);
}

/** Adopt every component a validated manifest declares. This is the ONE path a
 *  component enters by. It runs from loadPlugins with the manifest the host just
 *  fetched and checked — NOT from a copy esbuild baked into main.js, which is
 *  what let the host validate one document and obey another.
 *
 *  Returns an undo function that reverses every registration this call just
 *  made, in reverse order. loadPlugins keeps it and calls it if the plugin's
 *  own main.js throws afterwards, so a plugin that fails never half-installs
 *  — an engine visible in the selector with no DSP behind it. The loop is
 *  ALSO its own rollback boundary: if adopting components[1] throws, whatever
 *  components[0] just registered is undone here before the throw propagates,
 *  so the caller's undo (never assigned in that case) has nothing left to do. */
export function adoptComponents(components: ComponentManifest[]): Undo {
  const undoFns: Undo[] = [];
  try {
    for (const c of components) undoFns.push(adoptComponent(c));
  } catch (e) {
    while (undoFns.length) undoFns.pop()!();
    throw e;
  }
  return () => { while (undoFns.length) undoFns.pop()!(); };
}

let installed = false;

export function installMainThreadLoomApi(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(globalThis, 'Loom', {
    value: {
      apiVersion: LOOM_API_VERSION,
      // The main thread needs renderers too: the offline exporter runs the same
      // pure kernel here, not in the worklet.
      registerRenderer: (id: string, make: RendererFactory) => registerRenderer(id, make),
      // A copy of registerRenderer for a driver:'time' modulator's kernel. The
      // offline exporter (kernel-lane-render.ts) shares this same main-thread
      // realm and the same modulator-kernels registry singleton, so installing
      // it here is enough to cover export too — there is no separate site to
      // install it at for that path.
      registerModulatorKernel: (kernel: { id: string; valueAt(m: ModLiteLike, t: number, origin: number): number }) =>
        registerModulatorKernel(kernel),
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
