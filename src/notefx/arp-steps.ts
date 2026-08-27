// A written arpeggio pattern: which STEP OF THE POOL each tick plays.
//
// Indices, never notes. "The third of the pool" survives a transpose, a change
// of key and a change of scale; "G#" survives none of them, and an editor that
// stored absolute notes would be a worse piano roll — Loom already has one of
// those and it is very good.
//
// A STRING, because `NoteFxState.params` is a flat bag of scalars that already
// accepts one. The alternative was widening that type to carry arrays, which
// drags serialisation, the save format and undo along with it for the sake of a
// single control. The encoding is deliberately the one you would type: numbers
// separated by spaces, a dot for a rest.
//
//     "0 2 4 2 . 3"
//
// Worth knowing before reaching for this at all: **Karst has no pattern editor
// anywhere.** It answers the same need with per-trigger modulation — piece 3,
// shipped as `plugins/pernote` — and Loom now has a second answer in the
// generator's CADENCE. This is the third, and the only one where you say
// exactly what you want.
//
// Pure: a string in, numbers out.

/** What a rest looks like in the written form. A dot, the way a tracker writes
 *  one: short enough to keep a pattern readable at a glance, and impossible to
 *  confuse with an index. */
export const REST_TOKEN = '.';

/** A rest, once parsed. Not `-1`, which was the first sketch and is a real
 *  index: negatives wrap from the TOP of the pool, so `-1` is the note below
 *  the root and stealing it for a rest would remove the only way to reach it. */
export const REST = null;

export type ArpStep = number | null;

/** The pattern a fresh arp starts on: the plain upward walk it already did, in
 *  the written form. So switching PATTERN to `steps` changes nothing until you
 *  edit it — you see what you already had and start from there, rather than
 *  facing an empty box. */
export const DEFAULT_ARP_STEPS = '0 1 2 3';

/** Read a written pattern. Anything unparseable is a REST rather than an error:
 *  this is a text field somebody is typing INTO, so it is mid-edit most of the
 *  time, and a pattern that throws while you are halfway through a number would
 *  silence the lane on the way to being valid. */
export function parseArpSteps(src: string): ArpStep[] {
  return String(src ?? '')
    .split(/[\s,]+/)
    .filter((t) => t.length > 0)
    .map((t) => {
      if (t === REST_TOKEN || t === '-') return REST;
      const n = Number(t);
      return Number.isFinite(n) ? Math.trunc(n) : REST;
    });
}

/** Write one back out — for a UI that has edited the parsed form. */
export function formatArpSteps(steps: readonly ArpStep[]): string {
  return steps.map((s) => (s === REST ? REST_TOKEN : String(s))).join(' ');
}

/** The note a step plays, or REST.
 *
 *  The index wraps by FLOOR-mod over the pool, which is what keeps the pattern
 *  relative: the pool grows and shrinks under it as the scale, the octave count
 *  and the played note change, and a pattern written against a five-note pool
 *  still plays against a seven-note one instead of falling off the end. Wrapping
 *  is also what gives negatives a meaning — `-1` is the top of the pool, an
 *  octave down from where the walk would have started. */
export function stepNote(step: ArpStep, pool: readonly number[]): number | null {
  if (step === REST || pool.length === 0) return null;
  const i = ((step % pool.length) + pool.length) % pool.length;
  return pool[i];
}

/** The whole sequence, `count` long, cycling the written pattern.
 *
 *  An EMPTY pattern plays nothing at all rather than falling back to the
 *  upward walk. Clearing the box is a thing somebody does on purpose, and
 *  answering it with notes they did not write is worse than silence. */
export function arpStepSequence(
  steps: readonly ArpStep[], pool: readonly number[], count: number,
): (number | null)[] {
  if (steps.length === 0) return new Array(Math.max(0, count)).fill(null);
  const out: (number | null)[] = [];
  for (let i = 0; i < count; i++) out.push(stepNote(steps[i % steps.length], pool));
  return out;
}
