// The plugin manifest: everything the host needs to know about a plugin WITHOUT
// running it, and every question the host used to answer by comparing engine ids.
// Adding a field here is how a capability is born; a `switch` on an id in the
// host is, from now on, a bug.

/** Bumped only on an INCOMPATIBLE change. The host refuses to execute a plugin
 *  whose `loomApi` differs, so a stale plugin fails loudly instead of silently
 *  half-working. */
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

export interface EngineManifest {
  id: string;
  name: string;
  polyphony: 'mono' | 'poly';
  /** Which host clip editor this engine wants. */
  clipEditor: 'piano-roll' | 'drum-grid' | 'audio';
  params: EngineParamSpec[];
  /** Default modulator set, serialized — seeds the lane's modulation host. */
  modulators?: unknown[];
  /** Per-engine output balance against the other engines (what the host's
   *  ENGINE_TRIM table used to hold for built-ins). */
  outputTrim: number;
  /** Prefix for generated lane ids ("karplus" → "karplus-1"). */
  shortLabel: string;
  gm?: GmHint;
}

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
  engines?: EngineManifest[];
}

/** The runtime handshake. Installed by the host on globalThis in BOTH realms
 *  before any plugin code runs; a plugin never imports anything from the host. */
export interface LoomApi {
  readonly apiVersion: number;
  registerEngine(manifest: EngineManifest): void;
  registerRenderer(engineId: string, make: RendererFactory): void;
}

export type RendererFactory = (
  note: import('./types').NoteSpec,
  params: import('./types').ParamBag,
  sampleRate: number,
) => import('./types').VoiceRenderer;
