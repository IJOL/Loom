// Which key a piece of music is in, read off its pitch profile.
//
// The question is easy to state and easy to get subtly wrong. Finding WHICH
// SEVEN NOTES are in play is nearly free; finding which of them is HOME is the
// whole problem. A minor, C major and D dorian are the same seven notes, and no
// amount of counting note names separates them — only how hard the music leans
// on one of them does.
//
// So each candidate is a TEMPLATE with a shape rather than a set: the tonic
// weighted well above everything else, the fifth above the rest, and the other
// degrees level. Comparing shapes is then enough to answer both questions at
// once, and the mode that shares its notes with two others loses because its
// tonic is in the wrong place.
//
// Compared by COSINE — the angle between the two shapes, not their sizes. A
// loud passage and a quiet one in the same key must score the same, and energy
// the template has no room for costs the candidate its score automatically,
// which is what keeps a five-note scale from winning by simply asking for less.
//
// Pure: twelve numbers in, an answer out. No session, no DOM, no audio.

import { SCALE_CATALOG, scaleIntervals, type ScaleId } from '../core/musicality';
import { PITCH_CLASSES } from './pitch-profile';

export interface KeyCandidate {
  key: number;
  scale: ScaleId;
  /** 0..1, how well this template matches. Comparable only within one call. */
  score: number;
}

export interface KeyResult {
  key: number;
  scale: ScaleId;
  /** How sure the ROOT is, 0..1 — measured against the best candidate on a
   *  DIFFERENT root, never against a sibling mode.
   *
   *  Two questions hide in "what key is this", and they have very different
   *  answers. Measured on a plain minor scale: the top six candidates were all
   *  the same root wearing six different modes, within 5% of each other. The
   *  root was beyond doubt and the mode was a coin toss, and one number
   *  reporting 0.19 for that was reporting the coin toss.
   *
   *  This is the root's number because the root is what everything downstream
   *  needs: transposing material, choosing loops that agree, building chords.
   *  A mode is a colour on top and its doubt shows in `alternatives`. */
  confidence: number;
  /** How sure the MODE is, given the root — the winner against the best sibling
   *  on the same root. Low is the ordinary case and not a failure: minor and
   *  dorian differ by one note, and music that never plays that note genuinely
   *  is both. */
  modeConfidence: number;
  /** The rest, best first, the winner excluded. */
  alternatives: KeyCandidate[];
}

/** How much more the tonic and the fifth count than a plain degree.
 *
 *  These two numbers are the entire difference between "which notes" and "which
 *  key". Three and two are gentle: strong enough that a leaning tonic decides
 *  between modes sharing a note set, mild enough that a piece which happens to
 *  dwell on its fifth is not dragged a fourth away. */
const TONIC_WEIGHT = 3;
const FIFTH_WEIGHT = 2;
const DEGREE_WEIGHT = 1;

/** Every scale worth answering with — the SEVEN-NOTE scales, and nothing
 *  else. The two extremes are excluded for the same reason: a scale that
 *  cannot lose is not an answer.
 *
 *  `chromatic` contains every note, so it matches everything and says nothing.
 *
 *  A pentatonic is a subset of a seven-note scale. Anything that fits the
 *  parent fits it too, and it scores HIGHER for asking less — measured: a full
 *  minor scale over its own tonic came back "pentatonic minor" every time. It
 *  is a palette to write with, not a diagnosis, and answering one would only
 *  ever be the parent with notes hidden.
 *
 *  Filtered BY SIZE, not by name: this started as `!== 'chromatic' &&
 *  !== 'pentMinor'`, and the Scales & Chords round added two more pentatonics
 *  that sailed straight through the name check — detectKey answered 'hemiPent'
 *  for plain minor. Equal-size templates are the invariant the cosine needs
 *  (no candidate can win on shape alone, only on where its tonic sits), so the
 *  filter states it.  */
const CANDIDATE_SCALES: ScaleId[] = SCALE_CATALOG
  .map((s) => s.id)
  .filter((id) => scaleIntervals(id).length === 7);

/** A scale's shape, rooted at C. Rotated per key when it is compared. */
function template(scale: ScaleId): Float32Array {
  const out = new Float32Array(PITCH_CLASSES);
  for (const degree of scaleIntervals(scale)) {
    const pc = ((degree % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
    out[pc] = degree === 0 ? TONIC_WEIGHT : pc === 7 ? FIFTH_WEIGHT : DEGREE_WEIGHT;
  }
  return out;
}

const TEMPLATES: ReadonlyArray<{ scale: ScaleId; shape: Float32Array; norm: number }> =
  CANDIDATE_SCALES.map((scale) => {
    const shape = template(scale);
    let sq = 0;
    for (const v of shape) sq += v * v;
    return { scale, shape, norm: Math.sqrt(sq) };
  });

/** Cosine between the profile and a template rotated to `key`. */
function score(profile: Float32Array, profileNorm: number, t: typeof TEMPLATES[number], key: number): number {
  let dot = 0;
  for (let pc = 0; pc < PITCH_CLASSES; pc++) {
    // Rotate the TEMPLATE, not the profile: one modulo per bin either way, and
    // this keeps the profile untouched so a caller can hold on to it.
    dot += profile[pc] * t.shape[((pc - key) % PITCH_CLASSES + PITCH_CLASSES) % PITCH_CLASSES];
  }
  return dot / (profileNorm * t.norm);
}

/** The key a profile is in, plus how sure that is and what else it could be.
 *
 *  Silence answers with no confidence and no alternatives rather than with a
 *  default key. There is a real difference between "C major" and "nothing to go
 *  on", and a caller that cannot tell them apart will eventually stamp C major
 *  on an empty clip. */
export function detectKey(profile: Float32Array): KeyResult {
  let sq = 0;
  for (const v of profile) sq += v * v;
  const norm = Math.sqrt(sq);
  if (!(norm > 0)) {
    return { key: 0, scale: 'minor', confidence: 0, modeConfidence: 0, alternatives: [] };
  }

  const all: KeyCandidate[] = [];
  for (const t of TEMPLATES) {
    for (let key = 0; key < PITCH_CLASSES; key++) {
      all.push({ key, scale: t.scale, score: score(profile, norm, t, key) });
    }
  }
  all.sort((a, b) => b.score - a.score);

  const best = all[0];
  // Relative, never absolute: a cosine runs high for almost any musical profile
  // against almost any template — they all share most of their notes — so the
  // raw figure reads as confident for everything. What matters is whether
  // anything ELSE fits nearly as well, and which kind of else.
  const otherRoot = all.find((c) => c.key !== best.key);
  const sameRoot = all.find((c) => c.key === best.key && c.scale !== best.scale);

  return {
    key: best.key,
    scale: best.scale,
    confidence: margin(best.score, otherRoot?.score),
    modeConfidence: margin(best.score, sameRoot?.score),
    alternatives: all.slice(1),
  };
}

/** How decisively `best` beat `rival`, on a scale a person can read.
 *
 *  The raw gap is tiny by nature — two templates over the same twelve bins
 *  agree on most of them — so a real win looks like 5% and would report as
 *  "5% sure". Scaled by ten, a tenth of a gap reads as certain and a
 *  hundredth as a coin toss, which is how these actually distribute.
 *
 *  No rival at all means nothing to be unsure against. */
function margin(best: number, rival: number | undefined): number {
  if (rival === undefined || !(best > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - rival / best) * 10);
}
