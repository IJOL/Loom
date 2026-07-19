import type { ParsedMidi } from './midi-parse';
import { CLIP_COLOR_PALETTE, type SessionLane, type SessionClip, type SessionScene } from '../session/session';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import type { NoteEvent } from '../core/notes';
import { TICKS_PER_STEP } from '../core/notes';
import { findGMMatches, isDrumkitTrack, type GMMatch } from './gm-lookup';
import { planDrumLanes } from './percussion-split';
import { gmInstrumentName } from './gm-instruments';
import { makeTempoMap, hasTempoChanges } from '../core/tempo-map';

/** The bundled GM Percussion kit id (public/drumkits/gm-percussion.json). */
const GM_PERCUSSION_KIT = 'gm-percussion';

export interface MidiImportResult {
  newLanes: SessionLane[];
  scene: SessionScene;
  bpm: number | null;
  /** Song tempo map (Loom ticks) when the MIDI changes tempo; the transport uses
   *  it to show the live current BPM. Absent ⇒ constant tempo. */
  tempoMap?: import('../core/tempo-map').TempoMap;
  /** Total song length in Loom ticks (for looping the live tempo readout). */
  songTicks?: number;
  unmatchedTracks: { name: string; program: number }[];
}

const TICKS_PER_BAR = TICKS_PER_STEP * 16;

let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/** A MIDI track name that carries no instrument info — DAW-export cruft like
 *  "1", "MIDI out", "MIDI out #2", "Track 3", "untitled", or empty. These are
 *  dropped in favour of the channel's GM instrument (or a category label). */
export function isGenericTrackName(name: string | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (n === '') return true;
  if (/^\d+$/.test(n)) return true;                      // "1", "10"
  if (/^track\s*\d*$/.test(n)) return true;              // "track", "track 3"
  if (/^midi\s*(out|in)\s*#?\s*\d*$/.test(n)) return true; // "midi out", "midi out #2"
  if (/^(untitled|new|none|channel\s*\d*|inst(rument)?\s*\d*)$/.test(n)) return true;
  return false;
}

export function midiToSession(
  parsed: ParsedMidi,
  opts: {
    selectedTrackIndices: number[];
    presetPerTrack: Record<number, GMMatch>;
    /** Clip-slot/row this import's scene occupies. The grid couples row r ↔
     *  scene r ↔ clip slot r, so a scene appended at index N must place its
     *  clips at slot N to render on the same row as its launch button. Default
     *  0 (a fresh/Replace session whose only scene is row 0). */
    sceneRow?: number;
  },
): MidiImportResult {
  const sceneRow = Math.max(0, Math.floor(opts.sceneRow ?? 0));
  const selected = parsed.tracks.filter((t) => opts.selectedTrackIndices.includes(t.index));
  const scale = (TICKS_PER_STEP * 4) / parsed.division;

  let globalMinStart = Infinity;
  let globalMaxEnd = 0;
  for (const tr of selected) for (const n of tr.notes) {
    if (n.startTick < globalMinStart) globalMinStart = n.startTick;
    const end = n.startTick + n.duration;
    if (end > globalMaxEnd) globalMaxEnd = end;
  }
  if (!isFinite(globalMinStart)) globalMinStart = 0;

  const songTicks = Math.ceil((globalMaxEnd - globalMinStart) * scale);
  const lengthBars = Math.max(1, Math.ceil(songTicks / TICKS_PER_BAR));

  // Build the clip tempo map (scaled to Loom ticks, same origin as the notes).
  // Only attach it when the song actually changes tempo — a constant-tempo MIDI
  // keeps the normal single-BPM scheduling path, unchanged.
  const scaledTempos = (parsed.tempos ?? []).map((t) => ({
    tick: Math.max(0, Math.round((t.tick - globalMinStart) * scale)), bpm: t.bpm,
  }));
  const songTempoMap = scaledTempos.length ? makeTempoMap(scaledTempos) : null;
  const clipTempoMap = songTempoMap && hasTempoChanges(songTempoMap) ? songTempoMap : undefined;

  const newLanes: SessionLane[] = [];
  const clipPerLane: Record<string, number | null> = {};
  const unmatchedTracks: { name: string; program: number }[] = [];

  const convert = (n: { startTick: number; duration: number; midi: number; velocity: number }): NoteEvent => ({
    start: Math.round((n.startTick - globalMinStart) * scale),
    duration: Math.max(6, Math.round(n.duration * scale)),
    midi: n.midi,
    velocity: n.velocity,
  });

  // Create a lane (+ its single clip at sceneRow). Colour rotates by lane index so
  // adjacent imported lanes differ; without a colour the cell text is unreadable.
  const pushLane = (notes: NoteEvent[], clipName: string, laneProps: Partial<SessionLane> & { engineId: string }): void => {
    const clip: SessionClip = {
      id: nextId('clip'),
      name: clipName,
      color: CLIP_COLOR_PALETTE[newLanes.length % CLIP_COLOR_PALETTE.length],
      gridResolution: DEFAULT_RESOLUTION,
      lengthBars,
      notes,
      ...(clipTempoMap ? { tempoMap: clipTempoMap } : {}),
    };
    const clips: (SessionClip | null)[] =
      sceneRow > 0 ? [...Array<SessionClip | null>(sceneRow).fill(null), clip] : [clip];
    const lane: SessionLane = { id: nextId('lane'), clips, inserts: [], ...laneProps };
    newLanes.push(lane);
    clipPerLane[lane.id] = sceneRow;
  };

  // Collect lane specs first, then title each lane after its instrument (the MIDI
  // track name — informative in well-authored files), adding a numeric " 2"/" 3"
  // suffix only when several lanes would share the same name. Falls back to the
  // assigned preset / a generic label when a track has no name.
  interface LaneSpec { notes: NoteEvent[]; baseName: string; props: Partial<SessionLane> & { engineId: string }; }
  const specs: LaneSpec[] = [];

  for (const tr of selected) {
    const clipNotes = tr.notes.map(convert);
    const trackName = tr.name?.trim();

    // Percussion (channel 10) tracks are split: standard kit notes (kick/snare/
    // hats/toms/cymbals) → a normal Drums lane; GM-percussion notes (shaker/
    // tambourine/congas…) → a separate Drums lane on the GM Percussion sample kit.
    const named = isGenericTrackName(trackName) ? undefined : trackName;
    if (isDrumkitTrack(tr)) {
      const plan = planDrumLanes(clipNotes);
      if (plan.drum) {
        specs.push({ notes: plan.drum, baseName: named || 'Drums', props: {
          engineId: 'drums-machine',
          // A GM channel-10 kit track IS the GM "Standard" kit — name it, so the
          // lane loads an EXPLICIT preset (applied + recorded through the host
          // path) instead of riding the engine's implicit default and showing
          // "(custom — no preset)" in the dropdown.
          enginePresetName: 'engine:KIT Standard',
        } });
      }
      if (plan.perc) {
        specs.push({ notes: plan.perc, baseName: named || 'Percussion', props: {
          engineId: 'drums-machine',
          // Sample-kit Drums lane: kitMode 'sample' + the GM Percussion kit. The
          // import apply step (main.ts launchSceneById) loads it via applyDrumPreset.
          engineState: { kitMode: 'sample', sampler: { keymap: [], drumkitId: GM_PERCUSSION_KIT } },
          enginePresetName: 'engine:GM Percussion',
        } });
      }
      continue;
    }

    // Melodic track → normal engine/preset by GM program (name no longer forces drums).
    const prog = tr.program < 0 ? 0 : tr.program;
    const match = opts.presetPerTrack[tr.index] ?? { engineId: 'poly', presetName: 'Init' };
    if (findGMMatches(prog).length === 0) unmatchedTracks.push({ name: tr.name, program: prog });
    // Title after the instrument: the track name, else the GM program's instrument
    // name (so a format-0 channel reads "Electric Bass (finger)" not a preset id),
    // else the assigned preset.
    const instrument = tr.program >= 0 ? gmInstrumentName(tr.program) : undefined;
    specs.push({ notes: clipNotes, baseName: named || instrument || match.presetName, props: {
      engineId: match.engineId,
      // Unified vocabulary: a GM-matched built-in preset is `engine:<name>` for
      // every engine (the import path bypasses the load-time migration, so tag it
      // canonically at the source — otherwise the imported lane's preset dropdown
      // came up blank).
      enginePresetName: `engine:${match.presetName}`,
    } });
  }

  // Numeric dedup: a unique name stays clean; duplicates become "<name> 1", "<name> 2", …
  const totals: Record<string, number> = {};
  for (const s of specs) totals[s.baseName] = (totals[s.baseName] ?? 0) + 1;
  const seen: Record<string, number> = {};
  for (const s of specs) {
    let name = s.baseName;
    if (totals[s.baseName] > 1) { seen[s.baseName] = (seen[s.baseName] ?? 0) + 1; name = `${s.baseName} ${seen[s.baseName]}`; }
    pushLane(s.notes, name, { ...s.props, name });
  }

  const scene: SessionScene = {
    id: nextId('scene'),
    name: 'MIDI Import',
    clipPerLane,
  };

  return {
    newLanes, scene,
    // parsed.bpm is the effective starting tempo (the parser collapses junk events
    // crammed at the start to the real tempo).
    bpm: parsed.bpm,
    ...(clipTempoMap ? { tempoMap: clipTempoMap, songTicks } : {}),
    unmatchedTracks,
  };
}
