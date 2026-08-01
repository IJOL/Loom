// The runtime handshake, main-thread half.
//
// A plugin's main.js is compiled JS that cannot import anything of ours (our
// modules are bundled and hashed), so the meeting point is a global object. The
// worklet half lives in loom-processor.ts and installs the same shape there —
// separately addModule'd worklet modules do not share module instances, so a
// global is the ONLY place both halves can meet.
import { LOOM_API_VERSION, type ComponentManifest, type ModLiteLike, type RendererFactory } from '@loom/plugin-sdk';
import { registerEngine, registerEngineFactory } from '../engines/registry';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import { registerRenderer } from '../audio-dsp/renderer-registry';
import { registerModulatorKernel } from '../audio-dsp/modulator-kernels';
import { getCachedPresets } from '../presets/preset-loader';
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import { registerModulator, type ModulatorComponent } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';

function adoptEngine(m: ComponentManifest & { kind: 'engine' }): void {
  registerEngineCapabilities(m.id, m.capabilities, true);
  // editor is NOT passed here: createDescriptorEngine derives it from the
  // capability (defaultNoteView) just registered above, through the same
  // door a built-in engine goes through — one datum, one owner.
  const make = () => createDescriptorEngine({
    id: m.id,
    name: m.name,
    polyphony: m.polyphony,
    params: m.params,
    presets: () => getCachedPresets(m.id),
    modulators: (m.modulators ?? []) as ModulatorState[],
  });
  registerEngineFactory(m.id, make);
  registerEngine(make());
}

function adoptModulator(m: ComponentManifest & { kind: 'modulator' }): void {
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
}

function adoptComponent(m: ComponentManifest): void {
  if (m.kind === 'modulator') return adoptModulator(m);
  return adoptEngine(m);
}

let installed = false;

export function installMainThreadLoomApi(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(globalThis, 'Loom', {
    value: {
      apiVersion: LOOM_API_VERSION,
      registerComponent: (m: ComponentManifest) => adoptComponent(m),
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
