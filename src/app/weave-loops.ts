// What a lane can weave, and what those loops actually sound like.
//
// The pattern library is the point of WEAVE: hundreds of named loops per style,
// which is a great deal more to fade between than whatever happens to be sitting
// in the grid. The lane's own clips join the same list rather than replacing it,
// so a selection can mix the two — A a library breakbeat, B the clip you played
// in five minutes ago.
//
// One module because the two callers must agree exactly: the panel LISTS these
// and the scheduler RESOLVES them, and an id that lists but does not resolve is
// a loop that shows in the dropdown and plays silence.

import type { PanelChoice, PanelWeave } from '@loom/plugin-sdk';
import { abAdvance } from '../weave/topology-ab';
import type { NoteEvent } from '../core/notes';
import type { ScaleId, StyleId } from '../core/musicality';
import type { SessionLane } from '../session/session';
import type { LaneRole } from '../session/session-types';
import { isHarmonic } from '../plugins/capabilities';
import { laneRoleOf } from '../session/lane-role';
import { formatLoopId, parseLoopId } from '../weave/loop-ids';
import { scaleForDarkness, styleForLane } from '../weave/style-mix';
import { patternNotes, patternsFor, KIND_LABEL, type PatternKind } from '../patterns/pattern-library';
import { CHORD_SHAPES, renderChordShape, shapeForStyle } from '../core/harmony-shapes';

export interface WeaveLoopContext {
  lane: SessionLane | undefined;
  /** The style whose patterns this lane draws from — its own override, else the
   *  session's. */
  style: StyleId;
  /** False for a drum lane: it draws percussion patterns and is never snapped. */
  harmonic: boolean;
  key: number;
  scale: ScaleId;
  /** The session's scale lock. Closed, pitches are pulled into the key; open,
   *  every pattern arrives exactly as its author wrote it — and in acid those
   *  chromatic notes ARE the line. */
  lock: boolean;
  /** Set when DARKNESS has chosen the scale above, rather than the session.
   *
   *  It decides the same thing the lock does — whether a drawn loop is pulled
   *  into `scale` — and it has to, because the two answer different questions.
   *  The lock is about whether the SESSION's key may overwrite what an author
   *  wrote, and leaving it open is right. Darkness is the user reaching for a
   *  colour on purpose, and riding on the lock made it a knob that worked in
   *  the middle of a crossfade and did nothing at either end: the ends emit a
   *  loop unchanged, so there was no interpolation for it to colour. */
  darkened: boolean;
  /** How many bars the lane's clip is, so a drawn pattern fills it.
   *
   *  EVERY pattern in the library is one bar and a Loom clip is two by default,
   *  which is the whole of a bug reported from the panel: a two-bar clip woven
   *  against a library loop went silent for its second half as the fader crossed
   *  — the loop had no notes there to hand over. Weaving two CLIPS never showed
   *  it, because both sides had something to say in both bars.
   *
   *  `patternNotes` has taken `clipBars` since it was written, and its own doc
   *  names this exact failure. This context simply passed `undefined`. Absent ⇒
   *  one bar, which is what it did before. */
  clipBars?: number;
  /** Ticks per bar, needed alongside `clipBars` to place each repeat. */
  barTicks?: number;
}

/** Where the two macros that move MUSICAL state land.
 *
 *  Deliberately local to the weave rather than written into the session: the
 *  toolbar's key and scale are the user's, and a macro that overwrote them would
 *  give one number two owners — and leave the scene in whatever scale the knob
 *  happened to stop on. Here they colour what the weave DRAWS and BLENDS, and
 *  the session says what it always said. */
export interface WeaveMusicalMacros {
  /** 0 ⇒ every lane stays on the session's style. Above it, some lanes stray. */
  styleMix: number;
  /** Chooses the scale the blend walks its degrees in, brightest to darkest. */
  darkness: number;
  /** Which lane this is, and the session's seed. Together they make the draw
   *  repeatable: a lane must not change style because a curve was repainted. */
  laneIndex: number;
  seed: number;
}

/** Everything the list and the resolver need about a lane, gathered ONCE.
 *
 *  Both callers must agree exactly — the panel LISTS these loops and the
 *  scheduler RESOLVES them — and they used to build this separately, with the
 *  same three fallbacks written twice. An id that lists but resolves differently
 *  is a loop that shows in the dropdown and plays something else.
 *
 *  `forcedStyle` is the lane's own choice, and it beats the macro: the override
 *  exists precisely so the user can stop a lane straying. */
export function weaveLoopContext(
  lane: SessionLane | undefined,
  musicality: { key: number; scale: ScaleId; style: StyleId; lock: boolean },
  forcedStyle: StyleId | undefined,
  macros?: WeaveMusicalMacros,
  /** The clip the drawn loops have to fill. Both callers pass the same thing —
   *  one LISTS the loops and the other RESOLVES them, and a length that differed
   *  between them would show a loop and then play a different one. */
  fill?: { clipBars?: number; barTicks?: number },
): WeaveLoopContext {
  return {
    lane,
    clipBars: fill?.clipBars,
    barTicks: fill?.barTicks,
    style: macros
      ? styleForLane(musicality.style, macros.styleMix, macros.laneIndex, macros.seed, forcedStyle)
      : forcedStyle ?? musicality.style,
    // Asked through the capability door, so a plugin drum machine answers for
    // itself rather than the core keeping a list of ids that mean "drums".
    harmonic: lane ? isHarmonic(lane.engineId) : true,
    key: musicality.key,
    // At the neutral, darkness has no opinion and the session's scale stands.
    scale: macros && macros.darkness !== 0.5
      ? scaleForDarkness(macros.darkness)
      : musicality.scale,
    lock: musicality.lock,
    darkened: !!macros && macros.darkness !== 0.5,
  };
}

/** Which library shelves a lane reads — the ONE answer to "what may this lane
 *  play", asked by the panel that LISTS and by the scheduler that RESOLVES.
 *
 *  A drum lane reads percussion whatever its role says: a role left behind by an
 *  engine swap must not hand it melodic material.
 *
 *  An UNMARKED melodic lane gets both shelves, which is what it always got. The
 *  comment this replaces called that a guess that would otherwise hide half the
 *  library, and it was right — until there was somewhere to record the answer.
 *
 *  The chordal roles read NO shelf: there are no pad loops in the library and
 *  there never will be, because a chord written as fixed semitones cannot stay
 *  diatonic across the eight scales a session may be in. Their material is
 *  GENERATED. An empty list here is the answer, not a gap. */
export function sourcesFor(role: LaneRole | undefined, harmonic: boolean): PatternKind[] {
  if (!harmonic) return ['drums'];
  switch (role) {
    case 'bass':   return ['bass'];
    case 'melody': return ['synth'];
    case 'comp':
    case 'pad':
    case 'arp':    return [];
    default:       return ['bass', 'synth'];
  }
}

/** Whether this part's material is CHORDS.
 *
 *  Derived from the one door rather than listed again: a part that reads no
 *  pattern shelf reads no pattern shelf because its material is generated, and
 *  a second list of which parts those are is exactly the kind of thing that
 *  ends up disagreeing with the first. */
export function isChordalRole(role: LaneRole | undefined): boolean {
  return !!role && sourcesFor(role, true).length === 0;
}

/** Where a melodic pattern's root sits. Bass an octave under the lead, both
 *  moved to the session key so a library loop lands in the same tonality as
 *  everything already playing.
 *
 *  To the NEAREST tonic, not the one above. This used to add the key outright,
 *  which walks the whole shelf upwards as the key rises: the bass patterns live
 *  at MIDI 36..48 — C2..C3, a real bass register — and in A that became 45..57,
 *  which is A2..A3 and is not a bass any more. Reported as "nunca pones bajos
 *  que suenen a bajos", and measurable with tools/loop-fingerprints.ts.
 *
 *  A tonic is the same note in every octave, so choosing which one is free —
 *  and a player choosing between A1 and A2 for a bass line does not think about
 *  it either. Six semitones up or six down keeps every key within half an octave
 *  of the register the patterns were written for. */
/** Where each ROLE's material sits. A starting point to be adjusted by ear; what
 *  matters and is tested is the ORDER — bass below pad below comp below melody —
 *  so the parts do not sit on top of each other. */
const ROLE_BASE: Record<LaneRole, number> = {
  bass: 36, pad: 48, comp: 52, melody: 60, arp: 60,
};

/** The role's base BEFORE the key is added.
 *
 *  Two conventions meet here and neither is wrong. A library pattern is placed
 *  by `rootFor`, which hands `patternNotes` an absolute root already moved to
 *  the nearest tonic. A generated chord is placed by `scaleDegreeToMidi`, which
 *  adds the key ITSELF — so it needs the raw base, or the key lands twice. */
export function roleOctaveBase(role: LaneRole | undefined): number {
  return role ? ROLE_BASE[role] : 48;
}

export function rootFor(
  role: LaneRole | undefined, kind: PatternKind | undefined, key: number,
): number {
  // The ROLE when the lane has one, the PATTERN's kind when it does not.
  //
  // The fallback is not tidiness: an unmarked lane playing a bass pattern has
  // always sat at 36, and answering 48 for it would lift every existing
  // session's bass loops an octave — which is the one thing an optional mark is
  // supposed to guarantee it never does.
  const base = role ? ROLE_BASE[role] : kind === 'bass' ? 36 : 48;
  return base + nearestOffset(key);
}

/** The key as a shift of −6..+5 semitones rather than 0..+11. */
export function nearestOffset(key: number): number {
  return ((((key % 12) + 12) % 12) + 6) % 12 - 6;
}

export function weaveLoopChoices(c: WeaveLoopContext): PanelChoice[] {
  const out: PanelChoice[] = [];

  // The lane's own clips first: they are the loops the user made, and a list
  // that buries them under two hundred library entries reads as if they were
  // not offered at all.
  for (const [row, clip] of (c.lane?.clips ?? []).entries()) {
    if (!clip) continue;
    out.push({
      id: formatLoopId({ source: 'clip', clipId: clip.id }),
      name: clip.name || `Clip ${row + 1}`,
      group: 'This lane',
    });
  }

  // Resolved, not read raw: an engine may declare the part it is built for, and
  // the 303's lanes have to come out as bass whether or not anyone marked them.
  const role = laneRoleOf(c.lane);

  for (const kind of sourcesFor(role, c.harmonic)) {
    for (const p of patternsFor(c.style, kind)) {
      out.push({
        id: formatLoopId({ source: 'pattern', style: c.style, kind, index: p.index }),
        name: p.name,
        group: `${KIND_LABEL[kind]} · ${c.style}`,
      });
    }
  }

  // A chordal lane reads no shelf, so this is its whole list. Offered by SHAPE
  // — the rhythm — because the notes are decided per bar by the progression
  // rather than by the choice.
  if (c.harmonic && isChordalRole(role)) {
    // The style's OWN shape first, and marked. It is the answer — house comps
    // offbeat, jungle syncopated, ambient sustained, and the table that says so
    // has been in the tree since the Chords button was written. The other four
    // stay, because they are alternatives and not mistakes; what changes is
    // that the first one is now a recommendation instead of alphabetical luck.
    //
    // Being first is load-bearing, not decoration: a lane reseeded onto chords
    // takes the head of this list, so the order IS what a Pad lane starts on.
    const own = shapeForStyle(c.style);
    const ordered = [
      ...CHORD_SHAPES.filter((s) => s.id === own),
      ...CHORD_SHAPES.filter((s) => s.id !== own),
    ];
    for (const s of ordered) {
      out.push({
        id: formatLoopId({ source: 'chord', shape: s.id }),
        name: s.id === own ? `${s.label} · this style` : s.label,
        group: 'Chords',
      });
    }
  }
  return out;
}

/** The notes behind an id, or undefined when it names something that is gone.
 *
 *  One bar, never tiled: the blend describes a single bar and folds by position
 *  within it, so a tiled pattern would just repeat the same fold. */
export function weaveLoopNotes(id: string, c: WeaveLoopContext): NoteEvent[] | undefined {
  const parsed = parseLoopId(id);
  if (!parsed) return undefined;

  if (parsed.source === 'clip') {
    return c.lane?.clips.find((cl) => cl?.id === parsed.clipId)?.notes;
  }

  if (parsed.source === 'chord') {
    // One bar on the TONIC, exactly like a library pattern: applyProgression
    // moves it per bar downstream. Pre-applying a chord here would move it
    // twice.
    //
    // barTicks is required — a shape is a rhythm and there is nothing to place
    // it against without one. Absent means unresolvable, which the caller
    // already substitutes for.
    if (!c.barTicks) return undefined;
    return renderChordShape(parsed.shape, {
      key: c.key,
      scale: c.scale,
      // The RAW base for this role, not rootFor's — the triad adds the key
      // itself, so a base that already carried it would apply it twice.
      octaveBase: roleOctaveBase(laneRoleOf(c.lane)),
      barTicks: c.barTicks,
    });
  }

  const notes = patternNotes(
    parsed.style, parsed.kind, parsed.index,
    rootFor(laneRoleOf(c.lane), parsed.kind, c.key),
    // The clip the loop has to fill. patternNotes repeats the bar itself — the
    // mechanism has been there since it was written, and passing `undefined`
    // here is what left the second half of a two-bar clip silent.
    c.clipBars, c.barTicks,
    // Drums are never snapped — a GM drum note picks a voice, not a pitch — and
    // patternNotes already refuses to snap them. Passing the lock through keeps
    // the rule in ONE place instead of two that can disagree.
    //
    // `darkened` counts for the same thing as the lock and is a different
    // question. The lock asks whether the SESSION's key may overwrite what an
    // author wrote — open is the right default, since in acid the chromatic
    // notes ARE the line. Darkness is the user reaching for a colour on
    // purpose. Riding on the lock made it a knob that worked in the middle of a
    // crossfade and did nothing at either end, because an end emits its loop
    // unchanged and there is no interpolation there to colour.
    c.lock || c.darkened ? { key: c.key, scale: c.scale } : undefined,
  );
  // An index the library does not have comes back empty; that is a loop that is
  // gone, not a silent one.
  return notes.length > 0 ? notes : undefined;
}

/** Re-hook a lane that has just completed a lap onto a FRESH loop.
 *
 *  This is what makes A→B endless, and what the topology's own header always
 *  claimed it was: on arrival B becomes the new A and another loop is drawn, so
 *  the journey never ends and never returns to where it started. Without it a
 *  lap simply wrapped — the position jumped from the far end back to the near
 *  one and the same two loops crossed again, which is the "static on purpose"
 *  the panel exists to avoid.
 *
 *  Only A→B. The queue is a finite list the user ordered and the cloud's four
 *  corners are four choices; re-drawing either behind the user's back would be
 *  changing the material rather than continuing the journey.
 *
 *  The draw is DETERMINISTIC — seeded by the scene, the lane and the loop just
 *  arrived at — for the same reason the style draw is: the same scene has to
 *  travel the same way twice, and a Math.random here would make a session
 *  impossible to return to.
 *
 *  Returns null when there is nothing to do, so a caller running per tick can
 *  skip the write. */
export function rehookOnArrival(
  sel: PanelWeave | null | undefined,
  c: WeaveLoopContext,
  seed: number,
  laneId: string,
): PanelWeave | null {
  if (!sel || sel.kind !== 'ab') return null;

  // A lane's CLIPS are an arrangement: they advance IN ORDER, and shuffling
  // them would not be evolution, it would be noise. Only the library is drawn.
  //
  // EMPTY clips are skipped, rather than the whole clip family being excluded
  // as it was before: a weaving track is born with an empty carrier clip, and
  // landing the journey on it is silence with no way to tell why. Skipping only
  // the empty ones is the narrower rule that keeps the useful clips in.
  const clipIds = (c.lane?.clips ?? [])
    .filter((cl) => cl && cl.notes.length > 0)
    .map((cl) => formatLoopId({ source: 'clip', clipId: cl!.id }));

  const atClip = clipIds.indexOf(sel.b);
  if (atClip >= 0 && clipIds.length > 1) {
    // Round to the first rather than running out: a lane that reached its last
    // clip and stopped evolving would go quietly static while the rest travel.
    return { ...sel, a: sel.b, b: clipIds[(atClip + 1) % clipIds.length] };
  }

  // Not on a clip, or the only usable one — the library it is, so a lane with a
  // single clip still has somewhere to go.
  const pool = weaveLoopChoices(c).map((ch) => ch.id).filter((id) => id.startsWith('lib:'));
  if (pool.length === 0) return null;

  // A hash rather than a counter: nothing stores how many laps a lane has run,
  // and the loop it just arrived at stands in for "where the journey is" — it
  // differs on every leg by construction, since the draw never picks the loop it
  // came from.
  const pick = (n: number) => {
    let v = 2166136261;
    for (const s of [String(seed), laneId, sel.b]) {
      for (let i = 0; i < s.length; i++) v = Math.imul(v ^ s.charCodeAt(i), 16777619) >>> 0;
    }
    return v % Math.max(1, n);
  };

  const next = abAdvance({ a: sel.a, b: sel.b, x: 1 }, 1, pool, pick);
  // The POSITION stays the flow's: it has already wrapped to the near end of the
  // next leg. Writing abAdvance's own 0 here would yank the lane back a fraction
  // of a bar every lap.
  return { ...sel, a: next.a, b: next.b };
}
