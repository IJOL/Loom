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
  /** Knob taper. Absent ⇒ linear. */
  curve?: 'linear' | 'exponential' | 'log';
  /** Knob ring colour (any CSS colour, including a custom property). Overrides
   *  the colour this param's group declares. */
  color?: string;
  /** Declared for automation / modulation / presets / saves, but NOT drawn by
   *  the editor grid — the named surface draws it. NEVER means "drawn
   *  nowhere": a sound param with no control at all is a bug, not a feature.
   *  'modulators' = the ADSR/LFO panel owns it. */
  drawnBy?: 'mixer' | 'modulators';
  /** Discrete only: force a native <select> instead of the radio strip. */
  selectStyle?: 'dropdown';
  /** Discrete only: suppress the control's own name. Default true in the grid. */
  showLabel?: boolean;
  /** Discrete params only: this control's options come from ANOTHER param's
   *  current value, and the control is rebuilt when that param changes. It is
   *  how a control offers only what the rest of the patch makes honest — the
   *  filter Type offers only the taps the chosen Mode has.
   *
   *  A TABLE, not a function: a plugin declares its params in plugin.json, and
   *  JSON carries neither functions nor numeric keys. The key is the source
   *  param's value as a string; a value with no entry falls back to `options`.
   *  `options` stays as the list for the source param's DEFAULT value, so
   *  anything reading the spec statically still sees a valid list. */
  optionsFrom?: { paramId: string; table: Record<string, Array<{ value: string; label: string }>> };
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
  /** How this engine decides a note slides into the previous one. 'overlap':
   *  a note slides when another note in the clip started earlier and still
   *  covers this note's start tick — the TB-303 rule, and the reason a slide
   *  is not a flag on a NoteEvent. Absent ⇒ this engine never slides. */
  slide?: 'overlap';
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
  /** Entry point loaded on the MAIN thread. Absent ⇒ this plugin contributes no
   *  main-thread code. Its components come from THIS file, which the host reads
   *  and validates; a manifest is data, and data needs no entry point to be
   *  believed. Present for anything that must register a function the ABI cannot
   *  carry as JSON — an insert's `create`, for one. */
  main?: string;
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
 *  before any plugin code runs; a plugin never imports anything from the host.
 *  It carries CODE ONLY. A component's description is data, and data travels in
 *  plugin.json — the file the host reads, validates and obeys. */
export interface LoomApi {
  readonly apiVersion: number;
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
