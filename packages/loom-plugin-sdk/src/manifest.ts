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
  /** A param is one number. A component that needs a control shaped otherwise
   *  — a two-axis pad, a cursor over a list, a row of bars — asks the host for
   *  it at runtime through `Loom.controls` and places it in its own DOM zone.
   *  Declaring such shapes here was tried and reverted: the manifest can
   *  describe params but not an ARRANGEMENT, so a component whose layout is
   *  the point needs the zone regardless, and the extra kinds would have been
   *  permanent vocabulary serving exactly one plugin. */
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
  /** This engine synthesises through the SHARED worklet path — the same one
   *  every plugin engine uses. A plugin never sets it: bringing DSP through the
   *  ABI already means this, and the host infers it. It exists for the rare
   *  IN-TREE engine that also lives there, which today is LAYERS: it is in-tree
   *  only because it builds other engines out of the worklet's registry, a door
   *  the plugin ABI deliberately keeps shut. Without a way to declare this, the
   *  allocator would route it to no backend at all and the lane would be
   *  silent. Default: false. */
  workletHosted?: boolean;
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

/** Where the host hangs a panel component. `main-view` = a top-level view of
 *  its own, alongside Session and Performance.
 *
 *  A panel is the fourth kind of component and the only one with no audio job:
 *  it makes no sound, modulates nothing and processes nothing. That is why it
 *  declares neither polyphony nor capabilities — it owns no lane, so those
 *  questions have no answer for it. What it does need is somewhere to live,
 *  because unlike the other three it has no fixed place on screen. */
export interface PanelDeclaration {
  placement: 'main-view';
}

/** One lane, as a panel sees it. Deliberately a flat, serialisable summary:
 *  a panel's code is compiled separately and cannot hold our session objects. */
export interface PanelLane {
  id: string;
  name: string;
  engineId: string;
  presetId?: string;
}

/** What the host hands a panel when it mounts.
 *
 *  A panel's main.js cannot import anything of ours — our modules are bundled
 *  and hashed — so everything it needs to read or change arrives through this
 *  one object. Keeping it small is deliberate: each addition is a promise the
 *  host has to keep across versions. */
/** Something a panel can offer in a dropdown: an id and what to show. */
export interface PanelChoice {
  id: string;
  name: string;
  /** Optional heading this choice belongs under. A list long enough to need one
   *  — a whole pattern library, say — is unusable as a flat run of names. */
  group?: string;
}

/** A lane's transport and desk state, as a panel sees it.
 *
 *  Muted and soloed are the MIXER's, not a private copy: a panel that kept its
 *  own would let the same lane read soloed on one screen and muted on another. */
export interface PanelLaneTransport {
  playing: boolean;
  muted: boolean;
  soloed: boolean;
}

/** One note of the bar a lane is about to play.
 *
 *  The RESULT, not the material: what comes out of the fold at the position the
 *  lane sits at right now. A panel that can only show the names of two loops is
 *  showing its inputs and hiding the one thing it makes. */
export interface PanelNote {
  /** Where in the bar, 0..1. Normalised so a panel needs no idea what a tick is
   *  or how long a bar happens to be. */
  at: number;
  /** How much of the bar it lasts, 0..1. */
  length: number;
  midi: number;
  /** 0..127. */
  velocity: number;
  /** Which loop it survived from, when the lane's weave names one. This is what
   *  lets a drawing SHOW the handover: colour by origin and the crossfade stops
   *  being a number and becomes something you watch move. */
  from?: number;
}

/** The project's musical ground: the key everything is written in, the scale the
 *  blends walk their degrees in, the style the library draws from, and the
 *  tempo.
 *
 *  A panel READS and WRITES the session's own values here — it does not get a
 *  copy. The dialog, the toolbar chip and the panel are three views of one
 *  datum, which is the only arrangement in which they cannot disagree. */
export interface PanelMusicality {
  key: number;
  scale: string;
  style: string;
  bpm: number;
}

/** A row of steps that moves one parameter in time with the loop. */
export interface PanelSteps {
  destId: string;
  /** 0..1 each; the count IS the step count. */
  values: number[];
  mode: 'hold' | 'ramp';
  on: boolean;
}

/** Where the master flow stands.
 *
 *  `position` is read off the lanes rather than remembered beside the speed:
 *  with a journey running it is the host that moves them, and a second number
 *  would be the one the panel shows while the music followed the other. */
export interface PanelFlow {
  position: number;
  drift: string;
  speedBars: number;
  /** Whether arriving at the far end hands over to new material. */
  evolve: boolean;
}

/** Which loops a lane is weaving, and where between them it sits.
 *
 *  Loops are named by ID, never by their notes: a panel holds a flat summary of
 *  the session and the host owns the material. It is also what lets this be
 *  saved — a selection that carried note arrays would be a second copy of the
 *  clips, drifting from the first the moment either is edited.
 *
 *  The three shapes are the three topologies, and every one of them reduces to a
 *  list of (loop, weight) before anything downstream sees it. */
export type PanelWeave =
  | { kind: 'ab'; a: string; b: string; x: number }
  | { kind: 'queue'; loops: string[]; x: number }
  | { kind: 'cloud'; corners: string[]; x: number; y: number };

/** Where one loop is right now — the same reading the Session view's scene ring
 *  shows, narrowed to a single lane.
 *
 *  `frac` means two things on purpose, and the state says which: ELAPSED while
 *  the loop is simply going round, REMAINING once a switch is queued. That is
 *  what lets one wedge be drawn without branching on the state. */
export interface PanelLoopPhase {
  /** `silent` = the lane is neither playing nor waiting for anything. */
  state: 'silent' | 'idle' | 'armed' | 'imminent';
  frac: number;
  /** Length of the loop in bars. May be fractional. */
  bars: number;
  /** Pre-formatted centre reading: the bar the loop is in, or how much is left
   *  before a queued switch lands. The host formats it so it follows the
   *  session meter. */
  centerText: string;
}

export interface PanelContext {
  /** The lanes currently in the session, in order. */
  lanes(): PanelLane[];
  /** Every melodic engine a lane could be switched to. */
  engines(): PanelChoice[];
  /** The presets that engine offers. Empty for an engine that ships none. */
  presets(engineId: string): PanelChoice[];
  /** Swap a lane's instrument. Goes through the host's ONE engine-swap path,
   *  so a panel cannot leave a lane half-swapped in a way the session grid
   *  would not survive. */
  setEngine(laneId: string, engineId: string): void;
  /** Apply a preset to a lane, through the host's own preset path. */
  setPreset(laneId: string, presetId: string): void;
  /** A macro's current value, 0..1. Unknown ids read 0. */
  macro(id: string): number;
  /** Move a macro. Goes through the same door automation uses, so a panel
   *  cannot write somewhere automation could not. */
  setMacro(id: string, value: number): void;
  /** Re-render the panel: the host calls the mount's template again. */
  refresh(): void;
  /** Where the transport is inside the current bar, 0..1, or -1 when stopped.
   *
   *  Exposed so a panel can animate to the music without the host prescribing
   *  how it should look. Read it from requestAnimationFrame — it is a getter,
   *  not an event, so a panel that never animates costs nothing. */
  barPhase(): number;
  /** Whether the transport is running. */
  isPlaying(): boolean;
  /** How far along that lane's own loop is. Read it per frame from the same
   *  rAF that drives everything else a panel animates.
   *
   *  Per LANE rather than per scene because that is the question a weave asks:
   *  lanes here hold loops of different lengths on purpose, and one scene-wide
   *  number would hide exactly the thing worth seeing. A lane the host knows
   *  nothing about reads `silent`, never undefined. */
  loopPhase(laneId: string): PanelLoopPhase;
  /** Where a lane stands right now. Read it per frame — it is a getter, not an
   *  event, so a panel that never shows transport costs nothing. */
  laneTransport(laneId: string): PanelLaneTransport;
  /** Start or stop this lane. Launching is quantised exactly like the grid's,
   *  because it IS the grid's launch — a panel does not get a second one that
   *  could land off the bar. */
  setLanePlaying(laneId: string, playing: boolean): void;
  /** Silence a lane without stopping it: it keeps its place in the bar, so
   *  bringing it back drops it in where the music already is. */
  setLaneMuted(laneId: string, muted: boolean): void;
  /** Solo, sharing the ONE solo bus with the mixer. Two independent solo states
   *  would let a lane be soloed here and muted there. */
  setLaneSoloed(laneId: string, soloed: boolean): void;
  /** The loops this lane can weave: the pattern library for its style, plus its
   *  own clips. Grouped — the library alone runs to hundreds of entries. */
  loops(laneId: string): PanelChoice[];
  /** Every style the pattern library ships loops for. */
  styles(): PanelChoice[];
  /** The style this lane draws its library loops from — its own choice if it
   *  has made one, else the session's. */
  laneStyle(laneId: string): string;
  /** Point a lane at another style. Its loops change; what it is weaving does
   *  not, until the user picks again. */
  setLaneStyle(laneId: string, styleId: string): void;
  /** Whether this lane sits out the master flow's journey.
   *
   *  A locked lane holds its position while everything else travels — the way
   *  you keep one part still and let the rest move around it. It still counts in
   *  the fan, so locking one does not re-space the others under it. */
  laneLocked(laneId: string): boolean;
  setLaneLocked(laneId: string, locked: boolean): void;
  /** A lane's fader, in the mixer's own units — 0 is silence, 1 is unity and
   *  the top of the range is above it, so a panel that draws a slider takes
   *  `laneLevelRange()` rather than assuming 0..1.
   *
   *  It is the SAME gain the mixer column shows, not a second one: writing here
   *  moves that fader and vice versa. A lane with no strip reads 1, because a
   *  control showing 0 for "no audio graph" looks like a muted lane. */
  laneLevel(laneId: string): number;
  setLaneLevel(laneId: string, level: number): void;
  /** The declared range of the fader above, so a panel does not hardcode it. */
  laneLevelRange(): { min: number; max: number };
  /** The MASTER lock: keep the arrangement you have.
   *
   *  Set, no lane advances, no lane hands over, and a hand on the master fader
   *  or a lane's wheel writes nothing. Three things carry on underneath it, and
   *  each for its own reason: the CHORD PROGRESSION, because a lock on the
   *  loops is not a lock on the harmony; the MACROS, because they are the
   *  user's hand rather than evolution, and a locked scene deaf to a rise in
   *  Energy would pull apart from the rest; and the STEP RACK, because it moves
   *  a parameter in time with the loop, which is a sound moving rather than an
   *  arrangement changing.
   *
   *  It is not a mute and it never touches the desk. */
  locked(): boolean;
  setLocked(on: boolean): void;
  /** Whether the weave is bypassed: set, it contributes nothing, every lane
   *  schedules exactly as it did before the panel existed, and the transport
   *  stops with it — off means off, rather than uncovering whatever the session
   *  grid had launched. */
  bypassed(): boolean;
  setBypassed(on: boolean): void;
  /** The step RACK: rows of values, each moving one parameter in time with the
   *  loop, the way the old sequencers put a row of knobs under the pattern.
   *
   *  A list rather than one row, because one row is one parameter and a scene
   *  worth playing moves several — a cutoff opening while a delay send swells
   *  is two rows, not a compromise between them. Every method below takes the
   *  row it edits; out-of-range does nothing rather than throwing, since a row
   *  can be removed while a handler still holds its index. */
  stepRows(): PanelSteps[];
  /** Add an empty row, and return where it landed. */
  addStepRow(): number;
  removeStepRow(row: number): void;
  /** Draw one step. `index` into the row, `value` 0..1 — normalised, because
   *  what it means in hertz or decibels is the destination's business. */
  setStep(row: number, index: number, value: number): void;
  /** Point a row at a destination, switch it on, or change how a step reaches
   *  the next. An empty id parks the row: drawn, landing nowhere. */
  setStepsDest(row: number, destId: string): void;
  setStepsOn(row: number, on: boolean): void;
  setStepsMode(row: number, mode: 'hold' | 'ramp'): void;
  /** Reshape a whole row. The four the old boxes had, and they COMPOSE — each
   *  takes what is there rather than replacing it with a stored shape. */
  stepsTool(row: number, tool: 'up' | 'down' | 'invert' | 'random'): void;
  /** The chord progressions the scene can walk, and which one it is on.
   *
   *  Loom has always picked a key once and stayed there, so a scene could be
   *  busy for two minutes and still feel like it was standing still. A
   *  progression is what makes it leave home and come back. `id` 'static' is
   *  standing still, kept as an entry so it is a choice.
   *
   *  `name` and a plain-language `group` describing what it does to the ear —
   *  the panel shows those; nothing here speaks in roman numerals. */
  progressions(): PanelChoice[];
  progression(): string;
  setProgression(id: string): void;
  /** Where the chord walk is right now, for anything that DRAWS it.
   *
   *  `bar` is 0-based within the lap and `bars` is the lap's length, so a
   *  caller shows `bar + 1` of `bars` without knowing anything else; `degree`
   *  is the 0-based scale degree the current bar sits on, which a panel turns
   *  into a roman numeral if its readers want one. Null when no progression is
   *  running — a real answer, and not the same as sitting on the tonic.
   *
   *  Read off the same cursor the fold uses, so the number and the sound cannot
   *  drift apart by a bar. */
  chordNow(): { bar: number; bars: number; degree: number } | null;
  /** Everything a curve can be pointed at, from the ONE catalogue the rest of
   *  Loom automates through — so a step row can move anything a knob can, and
   *  nothing it cannot. */
  destinations(): PanelChoice[];
  /** The bar this lane is about to play, as it stands RIGHT NOW.
   *
   *  Folded by the same source the scheduler reads, so what a panel draws and
   *  what you hear cannot disagree — a second fold here would be a picture of a
   *  bar nobody plays. Empty for a lane weaving nothing.
   *
   *  Read it when the weave moves, not per frame: the fold is cached and the
   *  answer only changes when the position, the loops or a macro do. */
  laneNotes(laneId: string): PanelNote[];
  /** What the lane is weaving, or null when no loops have been chosen. */
  laneWeave(laneId: string): PanelWeave | null;
  /** Choose loops or move the position. Passing null clears the lane back to
   *  playing its clip untouched. */
  setLaneWeave(laneId: string, weave: PanelWeave | null): void;
  /** Move EVERY lane's cross-fade at once.
   *
   *  The difference between a panel you operate and a panel you play: dragging
   *  one lane's fader is an edit, this is a performance gesture. `drift` decides
   *  how the lanes relate while it moves — all together, fanned out, or each
   *  keeping its own place and merely nudged.
   *
   *  `speedBars` hands the journey over to the HOST: above zero, the flow keeps
   *  travelling on the audio clock, one lap every that many bars, whether or not
   *  the panel is open or its animation is running. Zero — the default — means
   *  it only moves when a hand is on it.
   *
   *  `evolve` is the panel's OTHER job. False — the default a session is saved
   *  in — the pair of loops a lane holds is the pair it keeps, and the journey
   *  simply has two ends. True, arriving at the far end is a handover: what was
   *  on the right becomes the left and new material arrives on the right, so the
   *  scene keeps moving instead of crossing the same two loops for ever. */
  setFlow(position: number, drift: string, speedBars: number, evolve: boolean): void;
  /** Where the master flow stands. Read it per frame: with a speed set, the host
   *  is moving it and the panel is following, not driving. */
  flow(): PanelFlow;
  /** Grow or shrink a lane's carrier clip by `factor` (2 doubles, 0.5 halves),
   *  REPEATING the bar rather than stretching it — the same operation the clip
   *  editor performs, through the same host function.
   *
   *  Length rather than tempo, because on a WEAVING lane the clip's own notes
   *  are replaced every tick and only its LENGTH survives: a phrase twice as
   *  long is a thing you can hear, a compressed set of notes nobody will play
   *  is not. */
  setClipLength(laneId: string, factor: number): void;
  /** The project's key, scale, style and tempo — the session's own, not a copy. */
  musicality(): PanelMusicality;
  /** Move them. Goes through the host's ONE musicality path, so a change made
   *  here undoes exactly like one made in Project Options and the toolbar chip
   *  follows it. */
  setMusicality(key: number, scale: string, style: string): void;
  // No setBpm. The transport's own BPM input is on screen above every panel and
  // already editable, so an ABI method for it would be a promise the host has to
  // keep forever in exchange for a control nothing should draw.
  /** The twelve roots, named the way the rest of the app names them. */
  keys(): PanelChoice[];
  /** Every scale the blends can walk. */
  scales(): PanelChoice[];
  /** Add a track, through the host's own add-lane path, and start it weaving:
   *  it arrives with its first two library loops already chosen.
   *
   *  Returns the new lane's id, or '' if the host refused. A lane that arrived
   *  empty would leave the panel exactly as useless as it was — picking the
   *  loops is the difference between "add a track" and "start weaving". */
  addLane(engineId: string): string;
  /** Re-draw which style each lane strays to. The style MIX stays where it is —
   *  this shuffles the deal, it does not change how far from home the lanes are
   *  allowed to wander. */
  reseed(): void;
  /** Freeze what the weave is playing RIGHT NOW into a new scene.
   *
   *  An output, never the goal: the panel exists so the music keeps moving, and
   *  a printed scene is a snapshot you can go back to — the weave carries on
   *  folding either way. Returns how many lanes were written, so a panel can say
   *  "nothing was weaving" instead of appearing to do nothing. */
  printScene(): number;
  /** Put a lane on a topology, KEEPING the loops it already names.
   *
   *  A door of its own rather than something a panel assembles, because which
   *  loops survive a change of control is a musical rule, not a layout one: the
   *  user picked them and expects to still be weaving them afterwards. */
  setLaneTopology(laneId: string, kind: PanelWeave['kind']): void;
}

export type ComponentManifest =
  | (ComponentManifestBase & { kind: 'panel'; panel: PanelDeclaration })
  | (ComponentManifestBase & { kind: 'engine'; polyphony: 'mono' | 'poly';
      modulators?: unknown[]; capabilities: EngineCapabilities;
      /** Declared editor layout for `params`. Optional: a manifest that omits
       *  it renders one row per raw `group` string, in first-appearance order
       *  — the same fallback a built-in engine gets when it declares no
       *  groups. Engine-only: a modulator's params render through the host's
       *  generic panel, which has no section layout to declare one for. */
      groups?: EngineParamGroup[] })
  | (ComponentManifestBase & { kind: 'modulator'; modulator: ModulatorDeclaration })
  | (ComponentManifestBase & { kind: 'fx'; fx: import('./fx').FxDeclaration });

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
  /** Hand the host the function that builds an insert's Web Audio nodes. The id
   *  must match a `kind: 'fx'` component in this plugin's manifest — a factory
   *  for anything else is refused rather than registered under a name nothing
   *  declared. */
  registerFx(id: string, create: import('./fx').FxFactory): void;
  /** Hand the host the function that fills a panel's DOM zone. Same two-halves
   *  arrival an fx has, for the same reason: a function cannot be JSON. The id
   *  must match a `kind: 'panel'` component in this plugin's manifest. */
  registerPanel(
    id: string,
    mount: (host: HTMLElement, ctx: PanelContext) => () => void,
  ): void;
  /** The host's control catalogue.
   *
   *  A param is one number; a two-axis pad, a cursor over a list and a row of
   *  bars are not. Rather than teaching the manifest to declare those shapes —
   *  which was tried and reverted, because a manifest can describe params but
   *  not an ARRANGEMENT — the host hands over the factories and the plugin
   *  places them in its own zone. The host still owns the drawing, so a plugin
   *  can arrange these but cannot paint their internals. */
  readonly controls: {
    pad2d(opts: {
      x: number; y: number; label?: string;
      onChange(x: number, y: number): void;
    }): { el: HTMLElement; set(x: number, y: number): void };
    queue(opts: {
      length: number; value: number; label?: string;
      onChange(v: number): void;
    }): { el: HTMLElement; set(v: number): void };
    steps(opts: {
      values: number[]; label?: string;
      onChange(index: number, value: number): void;
    }): { el: HTMLElement; set(values: number[]): void };
    /** The countdown ring, the same one the master strip carries. It keeps no
     *  clock of its own — whoever mounts it calls `set` from a frame loop it
     *  already has, so a panel does not grow a second timer that can disagree
     *  with the first about where the beat is. */
    loopRing(opts?: { label?: string }): {
      el: HTMLElement;
      set(phase: PanelLoopPhase): void;
    };
  };
}

export type RendererFactory = (
  note: import('./types').NoteSpec,
  params: import('./types').ParamBag,
  sampleRate: number,
  /** Per-lane state that is NOT a number — the only kind a param cannot carry.
   *  Optional and last, so a renderer written before this existed simply ignores
   *  an extra argument. `unknown` because the host does not know what a given
   *  engine's structural state looks like, and a union of the ones we ship today
   *  would have to grow for every future plugin. */
  structural?: unknown,
) => import('./types').VoiceRenderer;
