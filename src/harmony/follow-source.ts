// A follower lane's notes, as the same kind of source WEAVE hands the scheduler.
//
// Deliberately the shape of `WeaveSource` — a function of no arguments returning
// what the lane plays this iteration — because that is the shape
// `weave-wiring`'s notesFor already resolves and `ctx.notes` already accepts. A
// second hook in lane-scheduler for the same job would be a second answer to
// "what does this lane play", which is the thing this feature exists to avoid.
//
// Cached like the weave source, and for the same reason: this runs on the
// scheduler's tick.

import type { NoteEvent } from '../core/notes';
import type { LaneRole } from '@loom/plugin-sdk';
import type { ScaleId, StyleId } from '../core/musicality';
import type { Chord, Progression } from '../arranger/progression';
import type { WeaveSource, ReadNoteMacros } from '../weave/weave-runtime';
import { applyNoteMacros } from '../weave/macro-notes';
import { inferChords } from './infer-chords';
import { renderPart } from './render-part';
import { barsOfProgression } from './clip-window';
import { cyclesAt } from './cycle';
import { densityLean } from './part-types';

export interface FollowDeps {
  /** What the LEADER plays this iteration: its launched clip's notes, or its
   *  own weave source when the leader is itself weaving. Undefined ⇒ the leader
   *  is gone or silent, which is not an error — a follower whose leader was
   *  deleted mid-session must go quiet, not throw on the audio thread's tick. */
  leaderNotes: () => readonly NoteEvent[] | undefined;
  role: () => LaneRole | undefined;
  tonality: () => { key: number; scale: ScaleId };
  style: () => StyleId;
  barTicks: () => number;
  bars: () => number;
  octaveBase: () => number;
  /** A progression the user corrected by hand. Present ⇒ it WINS over whatever
   *  the analysis would have said — the same precedence `activeProgression`
   *  applies to a written progression over a picked one. */
  written: () => Progression | undefined;
  /** The progression the SESSION is walking — WEAVE's chord choice, whatever
   *  the toolbar's CHORDS is set to.
   *
   *  Used rather than inferred, and that ordering is the whole point. When the
   *  session already knows its harmony, deducing it back out of the leader's
   *  transposed notes is reconstructing a fact we were handed: measured over
   *  four known progressions against every melodic loop on the shelf, the
   *  analysis recovered the whole thing 7 times in 30. A readout naming one
   *  chord while the music plays another is the exact failure
   *  `activeProgression` exists to stop in the weave, and it would reappear
   *  here.
   *
   *  A ONE-chord progression means the user picked "Stay home", which is not a
   *  harmony to walk but the absence of one, so the analysis still runs.
   *  Undefined means the same for a caller with no weave at all. */
  sessionProgression?: () => Progression | undefined;
  /** The journey: the chosen progression as it stands after the travelling so
   *  far. Kept apart from `sessionProgression` so the two can be sampled at
   *  different moments — the user's CHOICE lands at once, the automatic travel
   *  waits for a bar line. Absent ⇒ the progression does not travel. */
  travel?: (base: Progression) => Progression;
  /** How many bars the FOLLOWER's own carrier clip runs for.
   *
   *  Not the leader's, which is `bars` and is a different question: that one
   *  sizes the analysis window, this one is the length the scheduler will loop.
   *  Everything outside it is discarded before it sounds, so a progression
   *  longer than this is heard a window at a time and a shorter one tiles.
   *
   *  Undefined ⇒ the progression is played whole, which is what this did
   *  before and is the only safe answer when the length is not known: guessing
   *  short truncates the harmony, and a follower with no clip of its own is the
   *  ORDINARY case rather than a broken one. */
  clipBars?: () => number | undefined;
  /** Whether this lane is actually playing.
   *
   *  It decides whether the harmony is LATCHED. A lane in flight must not have
   *  its chord changed halfway through a bar it is already sounding; a lane
   *  sitting still has no bar in flight to protect, and holding it there would
   *  mean editing the leader's clip, or picking a progression, showed nothing
   *  until the transport had gone round once. One is a glitch, the other is a
   *  dead control.
   *
   *  Absent ⇒ not playing, so a caller with no transport — a test, an offline
   *  render, the panel with the clock stopped — always sees the current
   *  answer. */
  playing?: () => boolean;
  /** Density and Energy, read at ask time.
   *
   *  Without these a follower is the ONE part in the session no knob can move:
   *  the harmony walks with the progression and the register with the octave
   *  fold, but nothing thins it out, nothing makes it lean. That is not a
   *  missing feature, it is the difference between a part and a drone — and it
   *  is why a derived accompaniment sounds the same in bar sixteen as in bar
   *  one however much else is travelling around it.
   *
   *  Optional: a caller with no panel (a test, an offline render) gets the
   *  neutral pair and the part comes out exactly as rendered. */
  macros?: ReadNoteMacros;
  /** Which repeat of its clip the lane is on.
   *
   *  A two-bar loop played twice is a FOUR-bar phrase, and that is the ordinary
   *  case here rather than the exception — which is why the shaping did nothing
   *  in practice: it leaves anything under three bars alone, so on a two-bar
   *  clip both bars came out identical and full, with no arc, no hole and no
   *  turn. It was written for four-bar material and only ever seen on it.
   *
   *  With the lap known, the same two bars are the FIRST half of the phrase on
   *  one pass and the SECOND on the next, so the loop is identical and what is
   *  played over it is not. Absent ⇒ always the top of the phrase, which is the
   *  old behaviour exactly. */
  lap?: () => number;
  /** How long this lane takes to repeat itself, 0..1.
   *
   *  Not "how much accompaniment" — how many independent WHEELS are turning,
   *  and therefore how many phrases pass before every one of them stands where
   *  it started. At 0 nothing turns and the lane repeats every phrase, which is
   *  what it did before this existed. At 1 four wheels of co-prime period take
   *  420 phrases to come back into line.
   *
   *  Absent ⇒ one wheel, which is exactly what this did before the ladder
   *  existed — see DEFAULT_LEVEL. */
  level?: () => number;
}

/** The shortest phrase worth shaping, in bars.
 *
 *  Four, because that is what a bar of music turns round in and what the
 *  shaping was designed against. A progression already this long or longer is
 *  its own phrase and is left alone. */
const PHRASE_BARS = 4;

/** The level a lane that has never been given one plays at.
 *
 *  ONE wheel — the figure — because that is what the accompaniment already did
 *  before the ladder existed, and what shipped and was liked. Zero is a real
 *  rung and a reachable one, but it is not where the music was standing: a
 *  default of 0 would have quietly taken the rotating comp figure away from
 *  every existing session as the price of gaining a knob.
 *
 *  So the knob goes DOWN into pure repetition as well as up into a long form,
 *  and leaving it alone changes nothing. */
export const DEFAULT_LEVEL = 0.25;

const NEUTRAL_MACROS: ReadNoteMacros = () => ({ density: 0.5, energy: 0.5 });

/** A cheap fingerprint of a note list.
 *
 *  Over start and pitch, not the whole event: those are the two fields the
 *  analysis reads, so a velocity edit on the leader is genuinely not a reason to
 *  re-derive. O(n) once per iteration — the same order as the fold beside it. */
function fingerprint(notes: readonly NoteEvent[]): number {
  let h = notes.length;
  for (const n of notes) h = (h * 31 + n.start + n.midi * 7) | 0;
  return h;
}

/** The progression this lane is playing — written if the user wrote one, else
 *  inferred from the leader.
 *
 *  Exported because the chord bar draws exactly this. Deriving it a second time
 *  there is how a readout ends up naming one chord while the music plays
 *  another, which is the failure `activeProgression` was written to stop in the
 *  weave and would otherwise reappear here.
 *
 *  An EMPTY written track means "nothing written", not "silence" — the editor
 *  cannot reach zero slots by design, so an empty one is a corrupt save rather
 *  than an instruction to stop the harmony. */
/** How many bars the MATERIAL spans, measured from the notes themselves.
 *
 *  Not the leader's clip length, which is a different number and was the bug:
 *  a lane weaving a four-bar library loop inside a two-bar clip handed over
 *  four bars of notes and got a two-bar analysis. The far half of the phrase
 *  was never looked at, so a progression that went i-VII-i-v came out as
 *  i-VII, repeating — which is heard, exactly, as "it alternates between two
 *  patterns". At one bar it comes out as i, which is heard as nothing at all.
 *
 *  The floor keeps a phrase that ends mid-bar from being rounded away, and the
 *  caller's own `bars` is a lower bound rather than the answer: a leader whose
 *  material is shorter than its clip still fills the clip. */
function barsOfMaterial(notes: readonly NoteEvent[], barTicks: number, atLeast: number): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + n.duration);
  return Math.max(atLeast, Math.ceil(end / barTicks));
}

export function progressionFor(deps: FollowDeps): Chord[] {
  const written = deps.written();
  if (written && written.length > 0) return written.map((c) => ({ ...c }));
  // Then the session's own, when it is walking one. Above the analysis and
  // below the hand-written track — the same precedence the weave already
  // applies, for the same reason: a guess never beats a statement.
  const chosen = deps.sessionProgression?.();
  if (chosen && chosen.length > 1) return chosen.map((c) => ({ ...c }));
  const notes = deps.leaderNotes() ?? [];
  if (notes.length === 0) return [];
  const { key, scale } = deps.tonality();
  const barTicks = deps.barTicks();
  return inferChords(notes, {
    key, scale, barTicks, bars: barsOfMaterial(notes, barTicks, deps.bars()),
  });
}

export function createFollowSource(deps: FollowDeps): WeaveSource {
  let cacheKey = '';
  let out: NoteEvent[] = [];
  /** The travelled progression, LATCHED to the lane's own bar line.
   *
   *  The journey is counted on the leader's legs, and the leader wraps when it
   *  likes — so a chord could arrive halfway through this lane's iteration and
   *  the rest of the bar would be scheduled from the new harmony. Reported from
   *  the panel: "cambian las notas y el follow está en medio del loop y
   *  cambia". Sampling it only when the lap moves means the harmony can only
   *  ever change where a bar does.
   *
   *  The user's own CHOICE is not held this way — that is in the cache key and
   *  lands at once, like a knob. Waiting is right for something that happened
   *  on its own and wrong for something somebody just did. */
  let heldLap: number | null = null;
  let heldChoice = '';
  let heldProg: Chord[] = [];

  return () => {
    const notes = deps.leaderNotes() ?? [];
    const role = deps.role();
    const { key, scale } = deps.tonality();
    const written = deps.written();
    const m = (deps.macros ?? NEUTRAL_MACROS)();
    const barTicks = deps.barTicks();
    const lap = deps.lap?.() ?? 0;
    const chosen = deps.sessionProgression?.();
    const choiceId = chosen ? chosen.map((c) => `${c.degree}:${c.bars}`).join(',') : '-';
    if (!deps.playing?.() || heldLap === null || lap !== heldLap || choiceId !== heldChoice) {
      heldLap = lap;
      heldChoice = choiceId;
      const base = progressionFor(deps);
      heldProg = (deps.travel ? deps.travel(base) : base).map((c) => ({ ...c }));
    }
    // Rounded, for the same reason the weave source rounds: a knob dragged
    // across an animation frame must not refold thousands of times, and 1e-3 of
    // a macro is finer than anything audible.
    const next = [
      fingerprint(notes), role ?? '-', key, scale, deps.style(),
      barTicks, deps.bars(), deps.octaveBase(),
      written ? written.map((c) => `${c.degree}:${c.bars}`).join(',') : '-',
      // The HELD progression, not the live one: what the lane is playing is
      // what was latched at its last bar line, and keying on anything else
      // would re-render to a harmony this iteration is not allowed to use yet.
      heldProg.map((c) => `${c.degree}:${c.bars}`).join(',') || '-',
      deps.clipBars?.() ?? '-',
      m.density.toFixed(3), m.energy.toFixed(3),
      // The lap is in the key because it CHANGES the answer now: the same notes
      // on the next pass are the other half of the phrase.
      lap,
      (deps.level?.() ?? DEFAULT_LEVEL).toFixed(3),
    ].join('|');

    if (next !== cacheKey) {
      cacheKey = next;
      const prog = heldProg;
      const own = prog.reduce((sum, c) => sum + Math.max(1, c.bars), 0);
      // Two bars of loop become the first half of a four-bar phrase on one lap
      // and the second half on the next. A progression already four bars or
      // longer is its own phrase and the offset stays at zero.
      const phraseLength = Math.max(own, PHRASE_BARS);
      // How much of the progression this iteration is allowed to sound. The
      // clip is the authority — everything outside it is discarded before it
      // reaches a voice — so this is the width of the window, and the lap says
      // where the window sits.
      const clipBars = Math.max(1, Math.floor(deps.clipBars?.() ?? own));
      const atBar = (lap * clipBars) % Math.max(1, own);

      // The part is rendered over the WHOLE progression, from its own top, and
      // windowed afterwards. Rendering only the window would ask each renderer
      // to voice-lead from nothing every couple of bars — a pad chooses its
      // inversion from the chord before it, and a chain restarted at every
      // window is a pad that leaps at the seam.
      const phraseOffset = own >= PHRASE_BARS ? 0 : (lap * own) % phraseLength;
      // Which PHRASE this is, not which lap: the style's palette turns over
      // once per phrase, so the figure lasts as long as the arc that shapes it.
      // Changing it per lap would re-deal the part in the middle of its own
      // opening — the same mistake the style draw made and had to be held to
      // two laps to fix.
      const variant = Math.floor((lap * clipBars) / phraseLength);
      // Which PHRASE this is — the one number every wheel is measured against.
      // They used to share a single counter, so figure, colour and everything
      // else changed on the same phrase and came round together: the scene
      // repeated as soon as the SHORTEST of them did. Given periods with no
      // common divisor, the same wheels take their product to come back into
      // line, which is how two bars become a long piece without one extra note
      // being written.
      const wheels = cyclesAt(variant, deps.level?.() ?? DEFAULT_LEVEL);
      const part = renderPart(role, prog, {
        key, scale, style: deps.style(), barTicks, octaveBase: deps.octaveBase(),
        phraseLength, phraseOffset,
        variant: wheels.figure,
        colour: wheels.colour,
        register: wheels.register,
        density: wheels.density,
      });
      // ON TOP of the rendered part, exactly where the weave applies them to
      // the blend: the macros shape whatever is playing, and what is playing
      // here is the accompaniment.
      //
      // The density WHEEL leans on the knob rather than replacing it, so the
      // user's setting stays the middle of the range instead of being
      // overwritten by something they did not touch.
      const leaned = { ...m, density: Math.min(1, Math.max(0, m.density + densityLean(wheels.density))) };
      out = applyNoteMacros(
        barsOfProgression(part, own, atBar, clipBars, barTicks), leaned, barTicks);
    }
    return out;
  };
}
