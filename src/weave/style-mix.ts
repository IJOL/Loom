// Which style a lane draws from, and which scale darkness lands on.
//
// These two are grouped because both are macros that move SESSION state rather
// than an automation destination: the style a lane pulls its loops from, and
// the scale the whole scene is in.

import { STYLE_CATALOG, type StyleId, type ScaleId } from '../core/musicality';

/** How long a lane keeps a style, in legs, at each end of the knob.
 *
 *  ONE knob, two things, and that is deliberate. Style mix used to say only
 *  WHETHER a lane strays; the hold was a fixed two legs, so the top of the knob
 *  meant "somewhere else, every two legs, chosen at random" — which at four
 *  bars a leg is a new style every eight bars, for ever. Reported as "el estilo
 *  cambia demasiado a menudo" and, separately, "a lo loco".
 *
 *  So the knob now moves how OFTEN and how FAR together, because that is what
 *  one word — how much does this scene wander — actually means. A second knob
 *  for the rate would be the same decision offered twice, and the pair would be
 *  free to contradict each other.
 *
 *  Sixteen legs at the bottom is a minute or so of one style; four at the top
 *  is a change roughly every sixteen bars. Neither end is churn.
 */
const HOLD_LEGS_STILLEST = 16;
const HOLD_LEGS_WILDEST = 4;

export function holdLegsFor(mix: number): number {
  const m = Math.min(1, Math.max(0, mix));
  return Math.max(1, Math.round(HOLD_LEGS_STILLEST + (HOLD_LEGS_WILDEST - HOLD_LEGS_STILLEST) * m));
}

/** How many steps along the catalogue a stray may travel, at most.
 *
 *  One at the bottom — the next style over, which shares nearly everything with
 *  where it came from — and three at the top, which is far enough to change the
 *  feel and near enough to still be the same night out. */
export function reachFor(mix: number): number {
  const m = Math.min(1, Math.max(0, mix));
  return 1 + Math.floor(m * 2.999);
}

/** Deterministic given (seed, laneIndex, salt).
 *
 *  This never reaches for Math.random, and that is the whole point: a lane must
 *  not change style because a curve was repainted or the panel re-rendered. The
 *  same scene has to draw the same way every time it is looked at. */
function hash(seed: number, laneIndex: number, salt: number): number {
  let h = (seed * 2654435761 + laneIndex * 40503 + salt * 2246822519) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

export function styleForLane(
  base: StyleId, mix: number, laneIndex: number, seed: number, forced?: StyleId,
  /** How many legs of the journey this lane has finished.
   *
   *  This is what turns Style mix from a coin thrown ONCE into a rate. Seed and
   *  laneIndex never move on their own, so without a leg the draw is decided
   *  the first time it is asked and never again — a lane strays or does not,
   *  for the life of the session, until somebody reshuffles by hand. The macro
   *  then answers "does this lane wander" when the question is "how often".
   *
   *  Defaults to 0, which is the scene at home: block 0 is always the base
   *  style, so a session that has not travelled is in the style it says it is
   *  in. */
  leg = 0,
): StyleId {
  // A forced style is the user speaking, so the macro gets no vote. That is the
  // entire purpose of the per-lane override.
  if (forced) return forced;
  if (mix <= 0) return base;

  // Home for the first block, always. A scene opens in the style it says it is
  // and travels away from it; a lane that was already somewhere else the first
  // time it was asked made the toolbar's Style a label for a place the music
  // had never been.
  const block = Math.floor(Math.max(0, leg) / holdLegsFor(mix));
  if (block <= 0) return base;

  // Two independent draws: one decides WHETHER this lane strays, the other
  // WHERE to. Sharing one would make the choice of style correlate with how
  // likely the lane was to move, which reads as the same few styles always
  // winning.
  //
  // Paired salts per block — 2n and 2n+1 — so the two draws stay independent of
  // each other AND of every other block. Adding the block to a single salt
  // would make block 1's "where" collide with block 0's "whether", and the two
  // would correlate again through the back door.
  if (hash(seed, laneIndex, block * 2) >= mix) return base;

  // WHERE is a step through the catalogue, not a throw of a twenty-sided die.
  //
  // It used to pick uniformly from every other style, so at the top of the knob
  // a downtempo scene could land in jungle and be back in ambient two blocks
  // later. Reported as "los estilos han variado a lo loco", and it is the same
  // fault the progression and the colour both had: travelling by teleport
  // rather than by neighbours. STYLE_CATALOG is already ordered by family —
  // the three technos, then the houses, then trance, then the breaks, then the
  // slow ones — so a step of one or two along it is a style that shares a
  // tempo, a kick and a century with the one it left.
  //
  // Measured from BASE rather than from wherever the lane last wandered, for
  // the reason the colour drifts around Mood rather than away from it: the
  // toolbar names the scene, and a cumulative walk would leave that name
  // describing only where the scene began.
  const home = STYLE_CATALOG.findIndex((s) => s.id === base);
  if (home < 0) return base;
  const reach = reachFor(mix);
  // 1..reach, never 0 — a "stray" that stayed would make the knob look broken
  // half the time it fired.
  const steps = 1 + Math.floor(hash(seed, laneIndex, block * 2 + 1) * reach);
  const dir = hash(seed, laneIndex, block * 4 + 3) < 0.5 ? -1 : 1;
  // Reflected at the ends rather than wrapped: wrapping puts ambient next to
  // techno, which is precisely the teleport this exists to stop.
  //
  // Reflection can bounce straight back onto home — two steps down from index
  // one mirrors to index one — and a "stray" that stayed would make the knob
  // look broken every time it happened. So the reflected result is checked and
  // pushed one further along, inwards, where home cannot be.
  const last = STYLE_CATALOG.length - 1;
  const raw = home + dir * steps;
  let i = raw < 0 ? Math.min(last, -raw) : raw > last ? Math.max(0, 2 * last - raw) : raw;
  if (i === home) i = home === 0 ? 1 : home - 1;
  return STYLE_CATALOG[i].id;
}


/** Brightest first, so a HIGH darkness lands at the dark end.
 *
 *  Every step down this ladder flattens exactly ONE degree — lydian ♮4→ major
 *  ♭7→ mixolydian ♭3→ dorian ♭6→ minor ♭2→ phrygian — which is what makes the
 *  knob read as a gradual darkening. It was four scales and major→dorian moved
 *  TWO notes at once, twice the size of every other step: reported as "darkness
 *  is almost a switch". Mixolydian is the missing rung; lydian extends the
 *  bright end by the same single-degree rule rather than by taste.
 *
 *  It cannot be made continuous, and that is not a defect to work around: notes
 *  are a semitone apart and a third of a semitone is detuning, not colour. The
 *  most a scale control can offer is steps this small. */
export const DARKNESS_SCALES: readonly ScaleId[] =
  ['lydian', 'major', 'mixolydian', 'dorian', 'minor', 'phrygian'];

export function scaleForDarkness(darkness: number): ScaleId {
  const d = Math.min(1, Math.max(0, darkness));
  // Math.floor(1 * n) is n, one past the last index -- hence the cap.
  const i = Math.min(DARKNESS_SCALES.length - 1, Math.floor(d * DARKNESS_SCALES.length));
  return DARKNESS_SCALES[i];
}

/** How many legs the scene keeps a colour before it may drift again.
 *
 *  Two, matching the style, and for a stronger reason: a mode is a far bigger
 *  thing to move than a shelf of loops. If anything this wants to be slower
 *  than the style, never faster. */
const DARKNESS_HOLD_LEGS = 2;

/**
 * The scale the scene is in RIGHT NOW — Mood's answer when Mood has one, the
 * session's own otherwise, and either of them drifted by however far the scene
 * has travelled.
 *
 * The drift used to hang off `scaleForDarkness`, which only ever ran when Mood
 * was off its neutral — and Mood sits at neutral unless somebody drags it. So
 * the colour of a travelling scene was, in practice, nailed down: reported as
 * "seguimos sin usar escalas para nuestras evoluciones", which was exactly
 * right and exactly invisible from the code, since the drift existed and was
 * tested and simply never got called.
 *
 * Whose scale is HOME is the only thing Mood decides here. At the neutral the
 * session's scale is home and the scene still travels around it; off the
 * neutral, Mood names home instead. Either way the scene moves.
 *
 * ONE rung either way, never further. Every step of the ladder flattens exactly
 * one degree, so a neighbour is the smallest colour change there is, and home
 * stays the centre of gravity rather than a place the scene wanders off from.
 *
 * A session in a scale the ladder does not carry — pentatonic, chromatic —
 * stays exactly where it is. The ladder is six modes of seven notes and there
 * is no honest neighbour for a five-note scale on it; drifting to one would be
 * changing how many notes the music has, which is not a colour change.
 */
export function sceneScale(
  sessionScale: ScaleId, darkness: number, leg = 0, seed = 0,
): ScaleId {
  const home = darkness !== 0.5 ? scaleForDarkness(darkness) : sessionScale;
  const at = DARKNESS_SCALES.indexOf(home);
  if (at < 0) return home;
  const held = Math.floor(Math.max(0, leg) / DARKNESS_HOLD_LEGS);
  if (held <= 0) return home;
  const drift = [0, 1, -1][Math.floor(hash(seed, 0, held * 3 + 2) * 3) % 3];
  return DARKNESS_SCALES[Math.min(DARKNESS_SCALES.length - 1, Math.max(0, at + drift))];
}
