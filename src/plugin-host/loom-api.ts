// The runtime handshake, main-thread half.
//
// A plugin's main.js is compiled JS that cannot import anything of ours (our
// modules are bundled and hashed), so the meeting point is a global object. The
// worklet half lives in loom-processor.ts and installs the same shape there —
// separately addModule'd worklet modules do not share module instances, so a
// global is the ONLY place both halves can meet.
import {
  LOOM_API_VERSION, type ComponentManifest, type ModLiteLike, type RendererFactory,
  type FxFactory, type PluginManifestFile,
} from '@loom/plugin-sdk';
import { registerEngine, registerEngineFactory, unregisterEngine } from '../engines/registry';
import { registerPanel, unregisterPanel } from './panel-registry';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import { registerRenderer } from '../audio-dsp/renderer-registry';
import { registerModulatorKernel } from '../audio-dsp/modulator-kernels';
import { getCachedPresets } from '../presets/preset-loader';
import { registerEngineCapabilities, unregisterEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import { registerModulator, unregisterModulator, type ModulatorComponent } from '../modulation/modulator-registry';
import { registerPlugin, unregisterPlugin } from '../plugins/registry';
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

// An fx component enters in two halves: its description comes from the
// manifest the host already validated, its factory from main.js — a function
// cannot travel as JSON. adoptFx only PARKS the description (together with
// the plugin file's version, which registerFxFactory needs for the registry
// manifest but has no other way to see once main.js is running); registerFx
// marries the two and registers the pair into the plugin registry that
// already exists (src/plugins/registry.ts). Storing the version alongside the
// parked description — rather than in a separate "current plugin" variable —
// means a parked entry is self-contained: whichever registerFx call claims it
// later reads the version it was declared with, not whatever a module-level
// variable happens to hold at that later moment.
//
// A half that never arrives is a broken plugin, and assertFxFactories is what
// refuses to let it look like a working one: staying quiet would be exactly
// the half-installed silent failure adoptComponents exists to prevent.
interface PendingFx { manifest: ComponentManifest & { kind: 'fx' }; version: string }
const pendingFx = new Map<string, PendingFx>();

// ids currently sitting in the real plugin registry because THIS module put
// them there via registerFx. Tracked for two reasons, both about telling
// "this module's own registration" apart from anything else that might sit
// at the same (kind, id) key: registerFxFactory uses it to tell a genuine
// double-registerFx call (a JS bug) apart from an id the manifest truly never
// declared (a manifest bug — see registerFxFactory), and the test-only reset
// below uses it to undo exactly what THIS module registered, never a blanket
// registry wipe that would just as happily erase a built-in insert or another
// plugin's entry with nothing to do with this module's own bookkeeping.
const registeredFxIds = new Set<string>();

function adoptFx(m: ComponentManifest & { kind: 'fx' }, version: string): Undo {
  pendingFx.set(m.id, { manifest: m, version });
  return () => {
    // Still parked ⇒ registerFx never claimed it: forget the parking, so no
    // later, unrelated plugin's registerFx(sameId, …) can claim it by
    // accident. Map#delete reports whether an entry was actually removed, so
    // that alone tells the two cases apart — no separate flag needed.
    if (pendingFx.delete(m.id)) return;
    // Already gone from pendingFx ⇒ registerFx DID claim it and a real
    // registration is sitting in the plugin registry (registerFxFactory
    // below). Undo THAT instead: a plugin that delivers one fx and then
    // fails on a LATER component must not leave the delivered one behind
    // under a plugin the report calls failed — the exact promise
    // plugin-host.ts's header makes ("nothing it registered may outlive the
    // failure").
    unregisterPlugin('fx', m.id);
    registeredFxIds.delete(m.id);
  };
}

function registerFxFactory(id: string, create: FxFactory): void {
  const pending = pendingFx.get(id);
  if (!pending) {
    // Two different reasons a claim can find nothing parked, and an author
    // chasing the wrong one wastes their time: this id was already claimed
    // (registerFx called twice for the same id — a JS bug in main.js), or
    // this plugin's manifest genuinely never declared an fx component with
    // this id (a manifest bug). registeredFxIds is what tells them apart —
    // without it, a double call falsely blames a manifest that was fine.
    if (registeredFxIds.has(id)) {
      throw new Error(`registerFx("${id}"): a factory is already registered for that id — registerFx must be called at most once per id`);
    }
    throw new Error(`registerFx("${id}"): this plugin's manifest never declared an fx component with that id`);
  }
  pendingFx.delete(id);
  const { manifest: m, version } = pending;
  registerPlugin({
    kind: 'fx',
    manifest: { id: m.id, name: m.name, kind: 'fx', version, params: m.params, presets: [], color: m.fx.color },
    create,
  });
  registeredFxIds.add(id);
}

/** Every fx a manifest promised must have arrived by the time its main.js has
 *  finished running. Throwing here puts the plugin in report.failed instead
 *  of listing an effect that does nothing when you insert it.
 *
 *  Asks pendingFx, NOT the plugin registry: the registry answers "does an fx
 *  with this id exist ANYWHERE", which is the wrong question the moment
 *  anything else — a built-in insert, an earlier plugin — already occupies
 *  the same id. pendingFx answers the right one, "did THIS plugin's own
 *  registerFx call for this id ever arrive": still parked here means it did
 *  not, regardless of what else happens to share the id. */
export function assertFxFactories(manifest: PluginManifestFile): void {
  const missing = manifest.components
    .filter((c): c is ComponentManifest & { kind: 'fx' } => c.kind === 'fx')
    .filter((c) => pendingFx.has(c.id))
    .map((c) => c.id);
  if (missing.length) {
    throw new Error(`declared fx component(s) [${missing.join(', ')}] but registered no factory for them`);
  }
}

function adoptPanel(m: ComponentManifest & { kind: 'panel' }): Undo {
  registerPanel({ id: m.id, name: m.name, placement: m.panel.placement, params: m.params });
  return () => unregisterPanel(m.id);
}

function adoptComponent(m: ComponentManifest, version: string): Undo {
  if (m.kind === 'modulator') return adoptModulator(m);
  if (m.kind === 'fx') return adoptFx(m, version);
  // Narrowed positively rather than by elimination. The previous `return
  // adoptEngine(m)` meant "anything that is not the other two", which stopped
  // being true the moment a fourth kind existed — and would have handed a
  // panel to the engine path with no polyphony and no capabilities.
  if (m.kind === 'engine') return adoptEngine(m);
  return adoptPanel(m);
}

/** Adopt every component a validated manifest declares. This is the ONE path a
 *  component enters by. It runs from loadPlugins with the manifest the host just
 *  fetched and checked — NOT from a copy esbuild baked into main.js, which is
 *  what let the host validate one document and obey another.
 *
 *  `version` is the plugin FILE's version — not any one component's — needed
 *  only by an fx component (see adoptFx); it defaults so every existing
 *  engine/modulator caller, none of which cares, is unaffected.
 *
 *  Returns an undo function that reverses every registration this call just
 *  made, in reverse order. loadPlugins keeps it and calls it if the plugin's
 *  own main.js throws afterwards, so a plugin that fails never half-installs
 *  — an engine visible in the selector with no DSP behind it. The loop is
 *  ALSO its own rollback boundary: if adopting components[1] throws, whatever
 *  components[0] just registered is undone here before the throw propagates,
 *  so the caller's undo (never assigned in that case) has nothing left to do. */
export function adoptComponents(components: ComponentManifest[], version = '1.0.0'): Undo {
  const undoFns: Undo[] = [];
  try {
    for (const c of components) undoFns.push(adoptComponent(c, version));
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
      registerFx: (id: string, create: FxFactory) => registerFxFactory(id, create),
    },
    writable: false,
    configurable: true,
  });
}

/** Test-only. */
export function __resetPluginEngines(): void {
  __resetCapabilities();
  pendingFx.clear();
  // Undo exactly what registerFx put in the plugin registry — not a blanket
  // _resetRegistry(), which would also erase built-in inserts and note-FX
  // that this module never touched. Without this, a fx a previous `it` block
  // registered outlives that test: __resetPluginEngines cannot clear state
  // it does not know exists, so two tests that happen to reuse the same fx
  // id pass or fail depending on declaration order instead of on their own
  // merits.
  for (const id of registeredFxIds) unregisterPlugin('fx', id);
  registeredFxIds.clear();
  installed = false;
}
