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
import { nextFromPool } from '../weave/loop-pool';
import type { NoteEvent } from '../core/notes';
import type { ScaleId, StyleId } from '../core/musicality';
import type { SessionLane } from '../session/session';
import type { LaneRole } from '../session/session-types';
import { isHarmonic } from '../plugins/capabilities';
import { laneRoleOf } from '../session/lane-role';
import { formatLoopId, parseLoopId } from '../weave/loop-ids';
import { redrawSlot } from '../weave/weave-selection';
import { cloudLegOrigin } from '../weave/topology-cloud';
import { sceneScale, styleForLane } from '../weave/style-mix';
import { patternNotes, patternsFor, KIND_LABEL, type PatternKind } from '../patterns/pattern-library';
import { PAD_LOOPS, renderPadLoop } from '../core/pad-loops';
import { shapeForStyle } from '../core/chord-rhythms';

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
  /** How many legs of the journey this lane has finished.
   *
   *  Without it the style draw is a coin thrown ONCE: seed and laneIndex never
   *  change on their own, so a lane either strays or does not and stays that way
   *  until somebody reshuffles by hand. Style mix then reads as "does this lane
   *  wander", when what it should mean is "how OFTEN". Reported exactly so:
   *  "style mix no hace nada si no das a reshuffle, debería actuar por sí
   *  mismo haciendo más frecuentes los cambios de estilo".
   *
   *  Absent ⇒ 0, which reproduces the old single throw — so a session that has
   *  not travelled yet draws precisely what it always drew. */
  legs?: number;
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
    // A lane that FOLLOWS never strays. Straying picks which shelf a lane
    // draws its loops from, and a following lane draws none — its style is
    // read for one thing only, the rhythm its part comps with. Left in, the
    // row showed "Electro" on a lane comping in Acid Techno, which is the same
    // readout-disagrees-with-the-music failure from the other side: the
    // picker was right about the shelf and the shelf was not being used.
    style: macros && !lane?.follow
      ? styleForLane(musicality.style, macros.styleMix, macros.laneIndex, macros.seed,
        forcedStyle, macros.legs ?? 0)
      : forcedStyle ?? musicality.style,
    // Asked through the capability door, so a plugin drum machine answers for
    // itself rather than the core keeping a list of ids that mean "drums".
    harmonic: lane ? isHarmonic(lane.engineId) : true,
    key: musicality.key,
    // The scale the SCENE is in, which is not always the session's.
    //
    // Asked even at the neutral Mood, which is the whole point of the change:
    // the drift used to hang off `scaleForDarkness` and that only ran when Mood
    // was off centre, so a scene left at the default never changed colour
    // however far it travelled. `sceneScale` takes the session's scale as home
    // instead, and Mood merely says whether home is somewhere else.
    scale: macros
      ? sceneScale(musicality.scale, macros.darkness, macros.legs ?? 0, macros.seed)
      : musicality.scale,
    lock: musicality.lock,
    // True when the scene is NOT in the session's scale — whoever moved it.
    //
    // It gates the snap, so it has to follow the scale rather than the knob:
    // now that a scene drifts a rung at the neutral Mood, a flag reading only
    // the knob would leave drawn loops in the session's scale while every
    // generated part was in the drifted one. Two scales at once, which is the
    // one thing worse than not drifting at all.
    darkened: !!macros
      && (macros.darkness !== 0.5
        || sceneScale(musicality.scale, macros.darkness, macros.legs ?? 0, macros.seed)
          !== musicality.scale),
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

/** A named entry for ANY loop id, whatever shelf it came from.
 *
 *  The list a lane is offered is one style's shelf, and a lane that has
 *  travelled is very often playing something drawn from another — so the id it
 *  holds is not in its own list, and the panel had nowhere to look the name up.
 *  It parsed one out of the id instead and showed "breakbeat drums #3", which
 *  is a database row where a name should be. Reported, bluntly and rightly:
 *  "no quiero volver a ver nombres estilo#numero".
 *
 *  The library HAS the name — patternsFor reads the catalogue for any style it
 *  is asked about, not merely the one on screen. The only thing missing was
 *  somebody asking it. Undefined for an id that names nothing real, which is a
 *  loop that is GONE rather than one that is elsewhere: the caller shows a dash
 *  for that, and a dash is honest.
 *
 *  The GROUP says which shelf it came from, so a name from another style does
 *  not read as if this lane's style had changed under you.
 */
export function weaveLoopEntry(id: string, c: WeaveLoopContext): PanelChoice | undefined {
  const parsed = parseLoopId(id);
  if (!parsed) return undefined;

  if (parsed.source === 'clip') {
    const row = (c.lane?.clips ?? []).findIndex((cl) => cl?.id === parsed.clipId);
    const clip = row >= 0 ? c.lane?.clips[row] : undefined;
    // A clip from ANOTHER lane is a real thing to be weaving and has no name
    // here; "Another clip" is what it is, and it beats a raw id.
    const name = clip ? (clip.name || 'Clip ' + (row + 1)) : 'Another clip';
    return { id, name, group: 'This lane' };
  }

  if (parsed.source === 'chord') {
    const shape = PAD_LOOPS.find((s) => s.id === parsed.shape);
    return shape ? { id, name: shape.label, group: 'Chords' } : undefined;
  }

  const entry = patternsFor(parsed.style, parsed.kind)[parsed.index];
  if (!entry) return undefined;
  return { id, name: entry.name, group: KIND_LABEL[parsed.kind] + ' · ' + parsed.style };
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
    const own = shapeForStyle(c.style) as string;
    const ordered = [
      ...PAD_LOOPS.filter((s) => s.id === own),
      ...PAD_LOOPS.filter((s) => s.id !== own),
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
    return renderPadLoop(parsed.shape, {
      key: c.key,
      scale: c.scale,
      // The RAW base for this role, not rootFor's — the triad adds the key
      // itself, so a base that already carried it would apply it twice.
      octaveBase: roleOctaveBase(laneRoleOf(c.lane)),
      barTicks: c.barTicks,
      // The clip this has to FILL. A shape is one bar and a Loom clip is two by
      // default, so without this a Pad or Comp lane went silent for the second
      // half of every clip — the same bug the library patterns had, fixed for
      // them on the line below and never carried across to here.
      bars: c.clipBars,
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
 *  A→B and the CLOUD, each in the way its own shape allows — the pair hands over
 *  and draws a new far end, the square swaps the corner the dot is furthest
 *  from. Not the queue: it is a finite list the user ORDERED, and re-drawing an
 *  entry of it behind their back would be changing the material rather than
 *  continuing the journey.
 *
 *  The draw is DETERMINISTIC — seeded by the scene, the lane and the loop just
 *  arrived at — for the same reason the style draw is: the same scene has to
 *  travel the same way twice, and a Math.random here would make a session
 *  impossible to return to.
 *
 *  Returns null when there is nothing to do, so a caller running per tick can
 *  skip the write. */
/** A number from the parts, for choosing without a counter.
 *
 *  Nothing stores how many laps a lane has run, so the draw is seeded by WHERE
 *  the lane is instead — which differs every lap by construction, since a lap
 *  always changes at least one of the loops in play. */
function hashOf(parts: readonly string[]): number {
  let v = 2166136261;
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) v = Math.imul(v ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return v;
}

/** How many candidates the draw has to be left with. Below two there is no
 *  choice to make, and a memory that leaves no choice has to give way: a short
 *  shelf repeats sooner, which is honest, and a lane that stopped evolving to
 *  protect its memory would be the very failure this guards against. */
const MIN_CANDIDATES = 2;

/** The shelf minus what the lane has played recently — oldest memories given up
 *  first when the shelf is too short to honour them all.
 *
 *  This is what stops the journey going round in circles. A lap draws from where
 *  the lane IS, so without this the walk over the shelf was `b → f(b)`: an
 *  iterated map on twenty states, which is eventually periodic by construction
 *  and whose cycles are short — a fifth of the lane/seed pairs settled into two
 *  loops alternating for ever, which is exactly what was reported from the
 *  panel. Remembering the loops already played turns the same draw into a walk
 *  that has to move on. */
function unplayed(pool: readonly string[], recent: readonly string[]): string[] {
  for (let keep = recent.length; keep > 0; keep--) {
    const banned = new Set(recent.slice(recent.length - keep));
    const out = pool.filter((id) => !banned.has(id));
    if (out.length >= MIN_CANDIDATES) return out;
  }
  return [...pool];
}

export function rehookOnArrival(
  sel: PanelWeave | null | undefined,
  c: WeaveLoopContext,
  seed: number,
  laneId: string,
  /** The loops this lane has already played, oldest first — the same trail the
   *  wheel winds back along. Absent, the draw only avoids where it stands, which
   *  is how the journey used to go round in circles. */
  trail?: readonly string[],
  /** The loops this lane draws from, in the order the user wrote them. When it
   *  has one, the hand-over WALKS it instead of drawing: the far end becomes
   *  the entry after the one being left. Absent or empty ⇒ the draw below,
   *  which is how every session without a list behaves. */
  pool?: readonly string[],
): PanelWeave | null {
  if (!sel) return null;

  // A CLOUD evolves by swapping out the corner nobody is hearing.
  //
  // It used to be refused outright — "four corners are four choices, and
  // re-drawing one behind the user's back would be changing the material". That
  // reasoning applied to replacing the square; replacing the FURTHEST corner is
  // the same move A→B makes, and for the same reason: the far end is the one you
  // are not listening to, so the material can change there without a cut.
  // Reported as "cloud no cambia en evolve", and it is the topology that most
  // needs it — a lap of a cloud crosses four loops and then crossed the same
  // four for ever.
  //
  // A CLOUD does NOT evolve here, and the reason is the whole of a bug.
  //
  // A lap ends where it began, so the position the flow writes just before this
  // is the same position every lap: the corner the path starts from at weight 1
  // and the far pair at exactly 0. "The quietest corner" was therefore the same
  // corner for ever — measured over twelve laps of a twenty-loop shelf, the four
  // corners held 1, 1, 1 and 4 loops, three of them stuck on whatever they were
  // dealt. Once per lap is also the wrong RATE: a lap of a cloud is four legs,
  // and a leg IS an A→B — it leaves one corner and arrives at the next.
  //
  // So the draw moved to `evolveCloudOnLeg`, which fires on each of those
  // arrivals and re-draws the corner just LEFT. See it for why that corner is
  // the safe one.
  if (sel.kind === 'cloud') return null;

  if (sel.kind !== 'ab') return null;

  // The written list wins over every draw below it — that is what writing one
  // means. It is read here rather than filtered into the pool further down
  // because the ORDER is the point: a filter would still hash, and the whole
  // request was "qué loops exactamente y en qué orden".
  if (pool && pool.length > 0) {
    // A list of ONE names one piece of material, so there is nowhere to hand
    // over to. Returning null holds the lane where it is, which is honest;
    // falling through to the shelf would play what the list excludes.
    if (pool.length === 1) return null;
    const b = nextFromPool(pool, sel.b);
    if (!b || b === sel.b) return null;
    return { ...sel, a: sel.b, b };
  }

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

  // Not on a clip, or the only usable one — the shelf it is, so a lane with a
  // single clip still has somewhere to go.
  //
  // "Not one of this lane's CLIPS", not "starts with lib:". A chordal lane
  // reads no pattern shelf at all — its material is generated and its ids start
  // `chord:` — so the narrower test gave it an empty pool and it returned null
  // on every arrival: a pad lane travelled its leg and then wove the same two
  // loops for ever, which is exactly what EVOLVE is for. Reported as "los pads
  // no siguen evolve, no cambian".
  // Named `shelf` and not `pool`: the pool is now the user's WRITTEN list, read
  // at the top of this function, and two things called pool in one place would
  // be exactly the confusion this feature exists to end.
  const shelf = weaveLoopChoices(c).map((ch) => ch.id).filter((id) => !id.startsWith('clip:'));
  if (shelf.length === 0) return null;

  // Everywhere it has been, most recent last. `sel.a` is the near end of the leg
  // just finished and belongs at the head of that memory: the caller pushes it
  // onto the trail AFTER this returns, so it is not in there yet.
  const fresh = unplayed(shelf, [...(trail ?? []), sel.a]);

  // The loop it just arrived at stands in for "where the journey is": it differs
  // on every leg by construction, since the draw never picks the loop it came
  // from.
  const pick = (n: number) => hashOf([String(seed), laneId, sel.b]) % Math.max(1, n);

  const next = abAdvance({ a: sel.a, b: sel.b, x: 1 }, 1, fresh, pick);
  // The POSITION stays the flow's: it has already wrapped to the near end of the
  // next leg. Writing abAdvance's own 0 here would yank the lane back a fraction
  // of a bar every lap.
  return { ...sel, a: next.a, b: next.b };
}

/** A cloud lane has just arrived at a corner: re-draw the one it came FROM.
 *
 *  This is the cloud's A→B, and it is a LEG and not a lap. A lap of a square is
 *  four legs — side or diagonal, depending on the path — and each one leaves a
 *  corner and arrives at the next with only those two loops mattering along the
 *  way. That is the same event as an A→B crossing, so it draws at the same rate:
 *  one corner per leg, four per lap, the whole square renewed every time round.
 *
 *  The corner just LEFT is the safe one, and it is safe twice over. At the
 *  moment of arrival the dot is standing on the next corner, so every other
 *  corner weighs exactly 0 and the swap cannot be heard. And the journey does
 *  not come back to it until the last leg of the lap, so the new material has
 *  the width of the square to arrive in — which is more room than A→B gives its
 *  own far end.
 *
 *  Null when there is nothing to do, so a caller running per tick can skip the
 *  write. */
export function evolveCloudOnLeg(
  sel: PanelWeave | null | undefined,
  c: WeaveLoopContext,
  seed: number,
  laneId: string,
  /** The leg the dot has just entered. The one that ENDED is the one before it,
   *  and its origin is the corner being left behind. */
  leg: number,
  trail?: readonly string[],
): PanelWeave | null {
  if (!sel || sel.kind !== 'cloud') return null;

  const pool = weaveLoopChoices(c).map((ch) => ch.id).filter((id) => !id.startsWith('clip:'));
  if (pool.length === 0) return null;

  // The square remembers itself. A cloud keeps no trail of its own — only A→B
  // records one — so what it has played is what its corners HOLD, and drawing
  // away from those is what stops the same handful of loops coming round again.
  const fresh = unplayed(pool, [...(trail ?? []), ...sel.corners]);
  const spin = hashOf([String(seed), laneId, sel.corners.join('|')]) % fresh.length;
  return redrawSlot(
    sel, cloudLegOrigin(sel.path, leg - 1), [...fresh.slice(spin), ...fresh.slice(0, spin)],
  );
}

/** How many legs back a lane can be wound. Saved with the session, so it is a
 *  memory and not a log: a scene left running for an hour would otherwise carry
 *  thousands of ids nobody is going to wind back to. */
export const TRAIL_MAX = 16;

/** Remember the loop this lane is leaving behind, so the wheel has somewhere to
 *  go back to. Oldest first; the newest is the one a rewind reaches first. */
export function pushTrail(trail: readonly string[] | undefined, leaving: string): string[] {
  const next = [...(trail ?? []), leaving];
  return next.length > TRAIL_MAX ? next.slice(next.length - TRAIL_MAX) : next;
}

/** Wind one leg BACK, onto the loop this lane came from.
 *
 *  The counterpart of `rehookOnArrival`, and deliberately not a mirror of it:
 *  going forward DRAWS — that is what makes the journey endless — and going
 *  back must not, or the way back would be a different journey from the way out
 *  and winding the wheel to and fro would shred the material instead of
 *  reviewing it.
 *
 *  The loop the lane is on becomes the FAR end, because that is where it was
 *  arrived at from; the one before it becomes the near end. The position is
 *  left to the caller — it has already wrapped round to the far end of this
 *  leg, which is exactly where a rewind lands.
 *
 *  Null when there is nothing behind: a lane at the start of its trail holds
 *  what it has rather than drawing something new, which would be travelling
 *  forwards while the hand went back. */
export function rehookOnRewind(
  sel: PanelWeave | null | undefined,
  trail: readonly string[] | undefined,
): { weave: PanelWeave; trail: string[] } | null {
  if (!sel || sel.kind !== 'ab') return null;
  if (!trail || trail.length === 0) return null;
  const back = trail[trail.length - 1];
  // The loop it came from IS the loop it is on: nothing to wind back to, and
  // swapping would make a leg from a loop to itself.
  if (back === sel.a) return null;
  return {
    weave: { ...sel, a: back, b: sel.a },
    trail: trail.slice(0, -1),
  };
}
