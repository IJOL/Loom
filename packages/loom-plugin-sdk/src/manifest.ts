// The plugin manifest: everything the host needs to know about a plugin WITHOUT
// running it, and every question the host used to answer by comparing engine ids.
// Adding a field here is how a capability is born; a `switch` on an id in the
// host is, from now on, a bug.

/** Bumped only on an INCOMPATIBLE change. The host refuses to execute a plugin
 *  whose `loomApi` differs, so a stale plugin fails loudly instead of silently
 *  half-working.
 *  UNCHANGED: stays at 1. This is the first implementation — there is no
 *  published plugin whose compatibility we'd need to preserve, and the only
 *  one that exists is converted on this same branch (Task 7). */
export const LOOM_API_VERSION = 1;

export interface EngineParamSpec {
  id: string;
  label: string;
  kind: 'continuous' | 'discrete';
  min: number;
  max: number;
  default: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Layout group this param belongs to — an id from the component's own
   *  `groups` table. Absent ⇒ the param renders in the leading ungrouped row,
   *  exactly like a built-in engine's param with no `group`. */
  group?: string;
}

/** One editor section a component's params can belong to. Mirrors
 *  src/engines/engine-param-groups.ts's EngineParamGroup on the host, so a
 *  plugin can declare its editor layout exactly like a built-in engine. */
export interface EngineParamGroup {
  /** Key referenced by an EngineParamSpec's own `group`. */
  id: string;
  /** Printed as the section header. */
  title: string;
  /** Groups sharing a row index render side by side on one line. Default: a
   *  row of its own, in declaration order. */
  row?: number;
  /** CSS colour for this section's knob rings. A param's own `color` wins. */
  color?: string;
}

export interface PresetEntry {
  name: string;
  gm?: number[];
  params: Record<string, number>;
  modulators?: unknown[];
}

/** Track-name keywords that should route a MIDI import onto this engine, plus
 *  where this engine sits when several plugins claim the same word (lower runs
 *  first). Replaces the hand-written NAME_ENGINE_HINTS table. */
export interface GmHint {
  keywords: string[];
  priority: number;
}

/** Assets a component accepts by drag-and-drop. */
export type AssetKind = 'audio-file';

/** Every question the host used to answer comparing engine ids.
 *  OMITTING is the normal case: a manifest that says nothing behaves like an
 *  ordinary melodic instrument. Only the unusual gets declared. */
export interface EngineCapabilities {
  /** What a clip of this engine CONTAINS, and therefore what kind of lane it is.
   *  Binary on purpose: 'notes' is any instrument — melodic, sampler or drum
   *  machine, all of them addressing pitches or pads; 'audio' is a channel whose
   *  clips ARE whole files. The host derives the editor from this. Never the
   *  other way round: a UI preference must not decide what a clip is. */
  clipContent: 'notes' | 'audio';
  /** Which of the note editor's two views a clip opens in. Only meaningful when
   *  clipContent is 'notes'. NOT a nature: the user flips between the two per
   *  clip (see editorOverride in session-inspector.ts). Default: 'pitches'. */
  defaultNoteView?: 'pitches' | 'pads';
  /** Prefix for generated lane ids ("karplus" → "karplus-1"). */
  shortLabel: string;
  /** Output balance against the other engines. */
  outputTrim: number;
  /** Drag-and-drop targets. Default: none. */
  accepts?: AssetKind[];
  /** False for engines that are not note-transformed (drums, audio). Default true. */
  acceptsNoteFx?: boolean;
  /** False for engines that cannot host a chord accompaniment. Default true. */
  harmonic?: boolean;
  /** Whether the "🎲 Sound" dice means anything for this engine. A melodic
   *  instrument has this: its sound is a bag of params the dice can roll. The
   *  sampler and the drum machine do not — their sound is a loaded kit or
   *  keymap, and there is nothing to roll. Neither does an audio channel.
   *  Default: true, so an instrument that says nothing gets its dice.
   *  Declaring false hides the button entirely — the host shows no dice rather
   *  than a dead one. */
  isRandomizable?: boolean;
  gm?: GmHint;
}

export interface ComponentManifestBase {
  id: string;
  name: string;
  params: EngineParamSpec[];
}

/** What a modulator component declares beyond the common fields. The host
 *  renders its params with the generic panel: a plugin cannot ship a
 *  template — its compiled main.js cannot import our bundled lit-html. */
export interface ModulatorDeclaration {
  /** What drives the value. 'time' runs off the clock and travels the
   *  worklet's per-sample kernel (registerModulatorKernel); 'gate' is driven
   *  by the note and travels the renderer's per-voice envelope road instead
   *  (ModEnvSpec/ModEnvHost) — that road stays closed to plugins for now (see
   *  the design doc §3.3). */
  driver: 'time' | 'gate';
  /** Scopes this modulator supports. The FIRST is the default for a new
   *  instance; there is deliberately no separate defaultScope field. */
  scopes: ('shared' | 'per-voice')[];
  /** Prefix for generated instance ids ('sh' → sh1, sh2…). */
  idPrefix: string;
}

export type ComponentManifest =
  | (ComponentManifestBase & { kind: 'engine'; polyphony: 'mono' | 'poly';
      modulators?: unknown[]; capabilities: EngineCapabilities;
      /** Declared editor layout for `params`. Optional: a manifest that omits
       *  it renders one row per raw `group` string, in first-appearance order
       *  — the same fallback a built-in engine gets when it declares no
       *  groups. Engine-only: a modulator's params render through the host's
       *  generic panel, which has no section layout to declare one for. */
      groups?: EngineParamGroup[] })
  | (ComponentManifestBase & { kind: 'modulator'; modulator: ModulatorDeclaration });

export interface PluginManifestFile {
  id: string;
  name: string;
  version: string;
  loomApi: number;
  author?: string;
  /** Entry point loaded on the MAIN thread. */
  main: string;
  /** Entry point added to the AudioWorklet (and imported on the main thread for
   *  offline render). Absent ⇒ this plugin has no per-sample DSP. */
  dsp?: string;
  /** Preset file, relative to the plugin directory. */
  presets?: string;
  /** A plugin that exists only to exercise the host: built on demand by tests,
   *  never written into plugins/index.json and never shipped. Absent means a
   *  normal plugin, so nothing an author writes has to opt IN to being real. */
  private?: boolean;
  /** REQUIRED. A manifest with no components contributes nothing, and making
   *  it optional would turn the old shape (`engines`) into a SILENT failure:
   *  it validates, loads, and registers zero. */
  components: ComponentManifest[];
}

/** The runtime handshake. Installed by the host on globalThis in BOTH realms
 *  before any plugin code runs; a plugin never imports anything from the host. */
export interface LoomApi {
  readonly apiVersion: number;
  registerComponent(manifest: ComponentManifest): void;
  registerRenderer(engineId: string, make: RendererFactory): void;
  /** A copy of registerRenderer for a driver:'time' modulator's per-sample
   *  kernel. `id` matches the modulator component's `id`. */
  registerModulatorKernel(kernel: {
    id: string;
    valueAt(m: import('./types').ModLiteLike, t: number, origin: number): number;
  }): void;
}

export type RendererFactory = (
  note: import('./types').NoteSpec,
  params: import('./types').ParamBag,
  sampleRate: number,
) => import('./types').VoiceRenderer;
