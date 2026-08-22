# Follower Lanes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to work through this task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is deliberately NOT test-first.** Per the user's direction (2026-08-15): write the code, get it working, then pin the behaviour with tests. Do not write a failing test before the implementation.

**Goal:** A lane that plays no material of its own and derives a chord accompaniment, every scheduling iteration, from the notes a leading lane is about to play.

**Architecture:** Two pure modules under a new `src/harmony/` — one that infers a chord progression from a leader's notes (weighted by metric position and duration, with inertia and a cadence preference), and one renderer per lane role that turns that progression into notes. A third wraps them in the same `WeaveSource` shape WEAVE already uses, so the feature reaches the scheduler through the existing `notesFor` door in `weave-wiring.ts` and `lane-scheduler.ts` learns nothing new.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-15-follower-lane-accompaniment-design.md`

## Global Constraints

- Commit messages in English. Always.
- Files stay under 300 code lines (target) / 500 (hard cap). Comment and blank lines do not count.
- `src/harmony/` is pure: no DOM, no `AudioContext`, no module-level mutable state.
- Test assertions are RELATIVE (ratios, comparisons), never absolute magnitudes.
- No `engineId === '…'` anywhere. Ask `src/plugins/capabilities.ts` or `laneRoleOf`.
- No `Math.random()` in any `src/harmony/` module — the follower must render identically offline and live.
- Run tests with `NO_COLOR=1 npx vitest run <path>`. Do not add `--reporter=`.
- Work in the worktree at `C:\Users\nacho\git\tb303-synth\.claude\worktrees\follow-lane-accompaniment` on branch `worktree-follow-lane-accompaniment`.
- **Never merge to `main`.** That is the user's call, every time.

## Existing API this plan builds on (verified signatures)

```ts
// src/core/notes.ts
export const TICKS_PER_QUARTER = 96;
export const TICKS_PER_STEP = 24;          // one 16th
export interface NoteEvent { start: number; duration: number; midi: number; velocity: number }

// src/core/musicality.ts
export type ScaleId = …; export type StyleId = …;
export function scaleIntervals(scale: ScaleId): number[];
export function scaleDegreeToMidi(degree: number, octaveBase: number, key: number, scale: ScaleId): number;
export function midiToScaleDegree(midi: number, key: number, scale: ScaleId, octaveBase: number): number;

// src/weave/metric-weight.ts
export function metricWeight(tick: number, barTicks: number): number;   // 0..1

// src/arranger/progression.ts
export interface Chord { degree: number; bars: number }   // degree is 0-BASED: 0 = tonic, 4 = V
export type Progression = readonly Chord[];

// src/core/harmony.ts
export function diatonicTriad(rootDegree: number, octaveBase: number, key: number, scale: ScaleId): number[];
export function nearestVoicing(triad: number[], prev: number[] | null): number[];

// src/core/chord-rhythms.ts
export interface Hit { stepOffset: number; durationSteps: number }
export const SHAPES: Record<ChordShapeId, Hit[]>;
export function shapeForStyle(style: StyleId): ChordShapeId;

// src/session/lane-role.ts
export function laneRoleOf(lane: SessionLane | undefined): LaneRole | undefined;
// LaneRole = 'bass' | 'comp' | 'pad' | 'arp' | 'melody'

// src/session/session.ts
export function resolveTonality(lane, state): { key: number; scale: ScaleId };

// src/weave/weave-runtime.ts
export type WeaveSource = () => WovenNote[] | undefined;

// src/app/weave-wiring.ts
export interface WeaveWiring { notesFor: (laneId: string) => WeaveSource | undefined; … }
```

## File Structure

| File | Responsibility |
| --- | --- |
| `src/harmony/infer-chords.ts` (new) | Leader notes → `Chord[]`. Weighted scoring, inertia, cadence. Pure. |
| `src/harmony/part-types.ts` (new) | `PartOptions`, `chordSpans` — what every renderer shares. |
| `src/harmony/parts/pad.ts` (new) | Long notes, one stack per chord. |
| `src/harmony/parts/bass.ts` (new) | Root and fifth, low register, on the style's rhythm. |
| `src/harmony/parts/comp.ts` (new) | Voiced triads on the style's rhythm, with anticipation. |
| `src/harmony/parts/arp.ts` (new) | Walks the chord tones. Deterministic. |
| `src/harmony/render-part.ts` (new) | `renderPart(role, progression, opts)` — the one door. |
| `src/harmony/follow-source.ts` (new) | Wraps inference + rendering as a cached `WeaveSource`. |
| `src/session/follow-eligible.ts` (new) | Which lanes may be a leader. Pure, shared by the UI and the loader. |
| `src/session/session-types.ts` (modify) | `follow?: { leaderId: string; chords?: Chord[] }` on `SessionLane`. |
| `src/session/session-migration.ts` (modify) | A `leaderId` naming a lane that is gone resolves to "not following". |
| `src/app/weave-wiring.ts` (modify) | `notesFor` returns the follow source when the lane follows. |
| `src/session/session-inspector.ts` (modify) | The Follow control on the lane. |
| `plugins/weave/…` (modify, Task 11) | The chord bar draws the progression. **Needs `npm run build:plugins` + a full page reload.** |

---

### Task 1: `lane.follow` — the data and its tolerance

**Files:**
- Modify: `src/session/session-types.ts`, `src/session/session-migration.ts`
- Test: `src/session/follow-migration.test.ts` (create, at the end)

**Produces:** `SessionLane.follow?: { leaderId: string }`. Every later task reads it.

- [ ] **Step 1: Add the field**

In `src/session/session-types.ts`, inside `interface SessionLane`, after the `role?: LaneRole;` block:

```ts
  /** The lane this one accompanies. Present ⇒ the lane plays nothing of its
   *  own: its notes are derived from the leader's, every scheduling iteration.
   *
   *  Only the leader is stored. WHAT the follower plays — bass, comp, pad, arp
   *  — is the lane's own `role`, resolved by `laneRoleOf`, because that answer
   *  already exists and a second copy here could disagree with it.
   *
   *  Mutually exclusive with `weave`: both decide what the lane plays, and the
   *  UI clears one when you set the other. */
  follow?: { leaderId: string };
```

- [ ] **Step 2: Make the loader tolerant**

In `src/session/session-migration.ts`, after the loop that normalises individual lanes (so it can see every lane):

```ts
  // A leaderId is a reference into the same session, so it can dangle: delete
  // the leading lane and every follower is left pointing at nothing. Resolving
  // that to "not following" rather than erroring is the tolerance the rest of
  // this file already applies — a session that lost a lane still loads.
  //
  // A lane following ITSELF is the degenerate cycle and goes here too, because
  // the follow source would end up asking itself for its own notes.
  const laneIds = new Set(lanes.map((l) => l.id));
  for (const l of lanes) {
    const leaderId = l.follow?.leaderId;
    if (leaderId === undefined) continue;
    if (leaderId === l.id || !laneIds.has(leaderId)) delete l.follow;
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 4: Pin it with tests**

Create `src/session/follow-migration.test.ts`. Use the migration's real exported name — open the file and check; the sketch below calls it `migrateSession`.

```ts
import { describe, it, expect } from 'vitest';
import { migrateSession } from './session-migration';

const lane = (id: string, extra: Record<string, unknown> = {}) => ({
  id, engineId: 'subtractive', clips: [null], inserts: [], ...extra,
});

describe('lane.follow survives a load', () => {
  it('keeps a leaderId that names a lane still present', () => {
    const out = migrateSession({ lanes: [lane('a'), lane('b', { follow: { leaderId: 'a' } })] } as never);
    expect(out.lanes[1].follow).toEqual({ leaderId: 'a' });
  });

  it('drops a leaderId naming a lane that is gone', () => {
    const out = migrateSession({ lanes: [lane('b', { follow: { leaderId: 'ghost' } })] } as never);
    expect(out.lanes[0].follow).toBeUndefined();
  });

  it('drops a lane following ITSELF — a cycle of one', () => {
    const out = migrateSession({ lanes: [lane('b', { follow: { leaderId: 'b' } })] } as never);
    expect(out.lanes[0].follow).toBeUndefined();
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/session/follow-migration.test.ts` — expect 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-types.ts src/session/session-migration.ts src/session/follow-migration.test.ts
git commit -m "feat(follow): a lane can name the lane it accompanies

Only the leader is stored. What the follower PLAYS is the lane's own
role, which laneRoleOf already resolves — a second copy of that answer
here would be free to disagree with it.

A leaderId is a reference into the same session, so it dangles the
moment the leading lane is deleted. The loader resolves that to not
following rather than erroring, and drops the one-lane cycle for the
same reason: a follow source that asked itself for its own notes."
```

---

### Task 2: `inferChords` — weight, inertia, cadence

**Files:**
- Create: `src/harmony/infer-chords.ts`
- Test: `src/harmony/infer-chords.test.ts` (create, at the end)

**Produces:**
```ts
export interface InferOptions {
  key: number; scale: ScaleId; barTicks: number; bars: number;
  inertia?: number; cadence?: number;
}
export function inferChords(notes: readonly NoteEvent[], o: InferOptions): Chord[];
```

- [ ] **Step 1: Write it**

Create `src/harmony/infer-chords.ts`:

```ts
// What chords a melody implies.
//
// This replaces the per-bar frequency vote in core/harmony.ts, which counted
// scale-degree occurrences and took the winner. That vote has no idea where a
// note fell or how long it lasted, so a sixteenth of passing tone off the beat
// carried exactly the weight of a whole-bar tonic on the downbeat — and with no
// inertia, a one-vote margin was enough to move the harmony every bar.
//
// Pure: notes in, a progression out. The SAME `Chord[]` a hand-written
// progression uses, so what is inferred and what is written are one kind of
// thing and the panel, the fold and the editor all read them the same way.

import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { midiToScaleDegree, scaleIntervals, type ScaleId } from '../core/musicality';
import { metricWeight } from '../weave/metric-weight';
import type { Chord } from '../arranger/progression';

export interface InferOptions {
  key: number;
  scale: ScaleId;
  barTicks: number;
  bars: number;
  /** How much staying put is worth, as a fraction of the bar's own weight.
   *  0 disables it and the analysis is memoryless. */
  inertia?: number;
  /** How much the last bar prefers V or I, in the same units. 0 disables it. */
  cadence?: number;
}

/** What a note contributes: where it falls, times how long it holds.
 *
 *  Multiplied rather than added because they are not two votes — they are one
 *  question ("how much does this note assert itself?") asked twice. A long note
 *  in a weak position and a short one on the downbeat both land in the middle,
 *  which is where the ear puts them.
 *
 *  Duration is measured in sixteenths and capped at the bar: a note held across
 *  the bar line belongs to this bar for as long as this bar lasts, no more. */
function noteWeight(startInBar: number, duration: number, barTicks: number): number {
  const steps = Math.max(1, Math.min(duration, barTicks) / TICKS_PER_STEP);
  return metricWeight(startInBar, barTicks) * steps;
}

/** The degree classes a triad on `degree` covers, in a scale of `len` degrees. */
function triadClasses(degree: number, len: number): Set<number> {
  return new Set([0, 2, 4].map((o) => (((degree + o) % len) + len) % len));
}

/** Material a candidate does NOT explain costs this much of its own weight.
 *
 *  Less than 1 on purpose. A chord is not disproved by a note outside it —
 *  every real melody passes through tones its harmony does not contain. What
 *  makes the discount safe is that `noteWeight` has already shrunk exactly the
 *  notes that ARE passing tones: short, off the beat, small weight. There is no
 *  separate "is this a passing note?" rule because there does not need to be. */
const OUTSIDE_COST = 0.5;

const DEFAULT_INERTIA = 0.15;

/** How much the final bar leans towards V or I.
 *
 *  Smaller than the inertia bonus deliberately: a cadence is a preference
 *  between candidates the material already supports, not a rule that overrides
 *  what the melody plainly says. A phrase that ends firmly somewhere else still
 *  ends there. */
const DEFAULT_CADENCE = 0.2;

export function inferChords(notes: readonly NoteEvent[], o: InferOptions): Chord[] {
  const len = scaleIntervals(o.scale).length;
  const inertia = o.inertia ?? DEFAULT_INERTIA;
  const cadence = o.cadence ?? DEFAULT_CADENCE;
  const degrees: number[] = [];
  let prev = 0;

  for (let bar = 0; bar < o.bars; bar++) {
    const lo = bar * o.barTicks;
    const hi = lo + o.barTicks;

    // Weight per degree class, gathered once and scored against every candidate.
    const weight = new Map<number, number>();
    let total = 0;
    for (const nte of notes) {
      if (nte.start < lo || nte.start >= hi) continue;
      const deg = midiToScaleDegree(nte.midi, o.key, o.scale, 0);
      const pc = ((deg % len) + len) % len;
      const w = noteWeight(nte.start - lo, nte.duration, o.barTicks);
      weight.set(pc, (weight.get(pc) ?? 0) + w);
      total += w;
    }

    // An empty bar holds the previous chord. Nothing happened; nothing should
    // change. The first bar has no previous and starts on the tonic.
    if (total === 0) { degrees.push(prev); continue; }

    const isLast = bar === o.bars - 1;
    let best = 0;
    let bestScore = -Infinity;
    for (let d = 0; d < len; d++) {
      const inside = triadClasses(d, len);
      let score = 0;
      for (const [pc, w] of weight) score += inside.has(pc) ? w : -OUTSIDE_COST * w;
      if (d === prev) score += inertia * total;
      // Degree 4 is the V and degree 0 the I, both 0-based. Only the last bar,
      // and only because this analysis can SEE the last bar — a design that
      // reacted to what already sounded has not heard it yet when it must choose.
      if (isLast && (d === 4 || d === 0)) score += cadence * total;
      // Strictly greater, so a tie goes to the LOWER degree and the answer is
      // the same on every run.
      if (score > bestScore) { bestScore = score; best = d; }
    }
    degrees.push(best);
    prev = best;
  }

  // Consecutive bars on the same chord are ONE chord that lasts longer, which
  // is what `Chord.bars` exists to say. One entry per bar would make every
  // progression look like it changes every bar even when it does not.
  const out: Chord[] = [];
  for (const degree of degrees) {
    const last = out[out.length - 1];
    if (last && last.degree === degree) last.bars += 1;
    else out.push({ degree, bars: 1 });
  }
  return out;
}
```

- [ ] **Step 2: Try it by hand before trusting it**

```bash
npx tsx -e "import {inferChords} from './src/harmony/infer-chords.ts';
const BAR=384, n=(s,d,m)=>({start:s,duration:d,midi:m,velocity:100});
console.log(inferChords([n(0,BAR,57),n(BAR,BAR/2,60),n(BAR+BAR/2,BAR/2,64)],
  {key:9,scale:'minor',barTicks:BAR,bars:2}));"
```

Expect two chords, the first on degree 0. If `tsx` is not available, skip to Step 3 — the tests cover it.

- [ ] **Step 3: Pin it with tests**

Create `src/harmony/infer-chords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { inferChords } from './infer-chords';

const BAR = TICKS_PER_QUARTER * 4;                    // 384 ticks in 4/4
const base = { key: 9, scale: 'minor' as const, barTicks: BAR, bars: 1, inertia: 0 };
const n = (start: number, duration: number, midi: number): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });
// A = 57, C = 60, E = 64 → the tonic triad of A minor (degrees 0, 2, 4).

describe('inferChords weighs position and duration', () => {
  it('names the tonic when the bar is built on it', () => {
    expect(inferChords([n(0, BAR / 2, 57), n(BAR / 2, BAR / 2, 60)], base))
      .toEqual([{ degree: 0, bars: 1 }]);
  });

  it('is not moved by a short passing note off the beat', () => {
    const withPassing = inferChords(
      [n(0, BAR - TICKS_PER_STEP, 57), n(BAR - TICKS_PER_STEP, TICKS_PER_STEP, 59)], base);
    const without = inferChords([n(0, BAR - TICKS_PER_STEP, 57)], base);
    expect(withPassing[0].degree).toBe(without[0].degree);
  });

  it('a downbeat note outweighs an equal note off the beat', () => {
    const out = inferChords(
      [n(0, TICKS_PER_STEP, 57), n(TICKS_PER_STEP, TICKS_PER_STEP, 62)], base);
    expect(out[0].degree).toBe(0);
  });

  it('merges consecutive bars on the same chord into one entry', () => {
    expect(inferChords([n(0, BAR, 57), n(BAR, BAR, 57)], { ...base, bars: 2 }))
      .toEqual([{ degree: 0, bars: 2 }]);
  });

  it('an empty leader yields the tonic rather than nothing', () => {
    expect(inferChords([], { ...base, bars: 2 })).toEqual([{ degree: 0, bars: 2 }]);
  });

  it('the last bar leans towards a cadence, earlier bars do not', () => {
    const notes = [n(0, BAR, 60), n(BAR, BAR / 2, 64), n(BAR + BAR / 2, BAR / 2, 59)];
    const out = inferChords(notes, { ...base, bars: 2 });
    expect(out[out.length - 1].degree).toBe(4);       // V at the end
    expect(out[0].degree).not.toBe(4);                // and not everywhere
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/harmony/infer-chords.test.ts` — expect 6 passing.

If the cadence test fails while the rest pass, `DEFAULT_CADENCE` is too small or too large. Adjust the constant, never the other tests' expectations.

- [ ] **Step 4: Commit**

```bash
git add src/harmony/infer-chords.ts src/harmony/infer-chords.test.ts
git commit -m "feat(harmony): infer a progression by weight, not by headcount

The vote this replaces counted scale-degree occurrences per bar and took
the winner, so a sixteenth of passing tone off the beat carried the
weight of a whole-bar tonic on the downbeat.

A note now contributes where it falls times how long it holds. The two
are multiplied rather than added because they are one question asked
twice, and the product is what makes a separate passing-note rule
unnecessary: a passing tone is already the small number.

Staying on the previous chord is worth a fraction of the bar's own
weight, so the harmony stops moving on a one-vote margin. The last bar
leans towards V or I — the one thing reading ahead buys that reacting
cannot, since you cannot prefer V at the end of a phrase you have not
yet heard."
```

---

### Task 3: The shared part options, and the two plain renderers

**Files:**
- Create: `src/harmony/part-types.ts`, `src/harmony/parts/pad.ts`, `src/harmony/parts/bass.ts`
- Test: `src/harmony/parts/pad-bass.test.ts` (create, at the end)

**Produces:** `PartOptions`, `PartRenderer`, `chordSpans`, `renderPad`, `renderBass`.

- [ ] **Step 1: Write `part-types.ts`**

```ts
// What every part renderer is handed, and the shape they all share.
//
// One options bag rather than a per-renderer signature, so `renderPart` can
// dispatch on the role without knowing which renderer it is about to call —
// and so adding a role later is a file and a line in a table, not a change to
// how the caller works.

import type { NoteEvent } from '../core/notes';
import type { ScaleId, StyleId } from '../core/musicality';
import type { Progression } from '../arranger/progression';

export interface PartOptions {
  key: number;
  scale: ScaleId;
  /** Decides the RHYTHM a part comps with, via `shapeForStyle`. */
  style: StyleId;
  barTicks: number;
  /** Where the part sits, as a MIDI note. Each renderer places itself relative
   *  to this — the bass drops below it, the pad and comp sit on it. */
  octaveBase: number;
}

export type PartRenderer = (progression: Progression, o: PartOptions) => NoteEvent[];

/** Where each chord of a progression starts, in ticks. Shared because every
 *  renderer walks a progression the same way, and three copies of this loop
 *  would be three chances to disagree about what `bars` means. */
export function chordSpans(
  progression: Progression, barTicks: number,
): { degree: number; start: number; ticks: number }[] {
  const out: { degree: number; start: number; ticks: number }[] = [];
  let at = 0;
  for (const c of progression) {
    const ticks = Math.max(1, c.bars) * barTicks;
    out.push({ degree: c.degree, start: at, ticks });
    at += ticks;
  }
  return out;
}
```

- [ ] **Step 2: Write `parts/pad.ts`**

```ts
// The pad: one stack per chord, held for as long as the chord lasts.
//
// It has no rhythm of its own on purpose. A pad that comped would be a comp;
// what a pad does is state the harmony and get out of the way, which is why it
// is the one part that ignores the style's shape entirely.

import type { NoteEvent } from '../../core/notes';
import { diatonicTriad, nearestVoicing } from '../../core/harmony';
import type { Progression } from '../../arranger/progression';
import { chordSpans, type PartOptions } from '../part-types';

const PAD_VELOCITY = 78;

export function renderPad(progression: Progression, o: PartOptions): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const span of chordSpans(progression, o.barTicks)) {
    // Chained rather than anchored: a pad is rendered over the whole
    // progression in one pass, so each chord genuinely has the previous one to
    // be near. (WEAVE's revoiceChords is anchored instead, because it re-derives
    // over a window shorter than the progression — see core/harmony.ts.)
    const triad = nearestVoicing(diatonicTriad(span.degree, o.octaveBase, o.key, o.scale), prev);
    prev = triad;
    for (const midi of triad) {
      out.push({ start: span.start, duration: span.ticks, midi, velocity: PAD_VELOCITY });
    }
  }
  return out;
}
```

- [ ] **Step 3: Write `parts/bass.ts`**

```ts
// The bass: one note at a time, under everything else.
//
// Root and fifth alternating across the style's own hits, rather than a root on
// every hit — a root-only bass is a drone, and the fifth is the one other note
// that never argues with the chord above it whatever the mode.

import type { NoteEvent } from '../../core/notes';
import { scaleDegreeToMidi } from '../../core/musicality';
import { SHAPES, shapeForStyle } from '../../core/chord-rhythms';
import type { Progression } from '../../arranger/progression';
import { chordSpans, type PartOptions } from '../part-types';

/** How far below `octaveBase` the bass sits. An octave: far enough that the
 *  comp and the pad have room above it, near enough that it is still the
 *  register the user chose rather than one decided for them. */
const BASS_DROP = 12;
const BASS_VELOCITY = 104;

export function renderBass(progression: Progression, o: PartOptions): NoteEvent[] {
  const shape = SHAPES[shapeForStyle(o.style)];
  const stepTicks = o.barTicks / 16;
  const out: NoteEvent[] = [];

  for (const span of chordSpans(progression, o.barTicks)) {
    const bars = Math.round(span.ticks / o.barTicks);
    const spanEnd = span.start + span.ticks;
    for (let bar = 0; bar < bars; bar++) {
      const barStart = span.start + bar * o.barTicks;
      shape.forEach((hit, i) => {
        const start = barStart + hit.stepOffset * stepTicks;
        if (start >= spanEnd) return;
        // Degree + 4 is the fifth in scale steps — the same [0, 2, 4] triad
        // diatonicTriad builds. Read here rather than taken from that triad so
        // the bass never picks up an inversion meant for the voicing of a part
        // three octaves above it.
        const degree = span.degree + (i % 2 === 0 ? 0 : 4);
        out.push({
          start,
          duration: Math.min(hit.durationSteps * stepTicks, spanEnd - start),
          midi: scaleDegreeToMidi(degree, o.octaveBase - BASS_DROP, o.key, o.scale),
          velocity: BASS_VELOCITY,
        });
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 5: Pin it with tests**

Create `src/harmony/parts/pad-bass.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER } from '../../core/notes';
import type { Progression } from '../../arranger/progression';
import { renderPad } from './pad';
import { renderBass } from './bass';

const BAR = TICKS_PER_QUARTER * 4;
const o = { key: 9, scale: 'minor' as const, style: 'lo-fi' as const, barTicks: BAR, octaveBase: 48 };
const PROG: Progression = [{ degree: 0, bars: 1 }, { degree: 5, bars: 1 }];

describe('renderPad', () => {
  it('emits one stack per chord and nothing in between', () => {
    expect(new Set(renderPad(PROG, o).map((n) => n.start))).toEqual(new Set([0, BAR]));
  });

  it('holds each stack for the whole chord', () => {
    for (const n of renderPad([{ degree: 0, bars: 2 }], o)) expect(n.duration).toBe(2 * BAR);
  });

  it('voices the second chord near the first rather than rebuilding it low', () => {
    const out = renderPad(PROG, o);
    const first = out.filter((n) => n.start === 0).map((n) => n.midi).sort((a, b) => a - b);
    const second = out.filter((n) => n.start === BAR).map((n) => n.midi).sort((a, b) => a - b);
    const moved = first.reduce((s, m, i) => s + Math.abs(second[i] - m), 0);
    const naive = first.reduce((s, m, i) => s + Math.abs((second[i] - 12) - m), 0);
    expect(moved).toBeLessThanOrEqual(naive);
  });
});

describe('renderBass', () => {
  it('plays one note at a time — a bass is not a chord', () => {
    const byStart = new Map<number, number>();
    for (const n of renderBass(PROG, o)) byStart.set(n.start, (byStart.get(n.start) ?? 0) + 1);
    for (const count of byStart.values()) expect(count).toBe(1);
  });

  it('stays below the pad', () => {
    const lowestPad = Math.min(...renderPad(PROG, o).map((n) => n.midi));
    expect(Math.max(...renderBass(PROG, o).map((n) => n.midi))).toBeLessThan(lowestPad);
  });

  it('starts every chord on its root', () => {
    const first = renderBass(PROG, o).filter((n) => n.start === 0)[0];
    const root = Math.min(...renderPad([PROG[0]], o).map((n) => n.midi));
    expect((first.midi - root) % 12).toBe(0);
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/harmony/parts/pad-bass.test.ts` — expect 6 passing. If "stays below the pad" fails, raise `BASS_DROP`: `nearestVoicing` is bounded to within an octave of root position, so an octave of clearance is the minimum that always works.

- [ ] **Step 6: Commit**

```bash
git add src/harmony/part-types.ts src/harmony/parts/pad.ts src/harmony/parts/bass.ts src/harmony/parts/pad-bass.test.ts
git commit -m "feat(harmony): the pad and the bass

Two renderers and the options bag they share. chordSpans is shared
rather than copied because every renderer walks a progression the same
way, and three copies of that loop are three chances to disagree about
what bars means.

The pad ignores the style's rhythm entirely, which is the difference
between a pad and a comp: it states the harmony and gets out of the way.
The bass alternates root and fifth across the style's hits — root-only
is a drone, and the fifth is the one other note that never argues with
the chord above it whatever the mode."
```

---

### Task 4: The comp, and its anticipation

**Files:**
- Create: `src/harmony/parts/comp.ts`
- Test: `src/harmony/parts/comp.test.ts` (create, at the end)

**Produces:** `renderComp(p: Progression, o: PartOptions): NoteEvent[]`

- [ ] **Step 1: Write it**

```ts
// The comp: voiced chords on the style's rhythm, entering early when the
// harmony moves.
//
// The anticipation is the whole reason this is not renderChordComp with better
// voicing. A chord that lands exactly on the bar line every time is what makes
// generated accompaniment sound generated; a player leans into the change and
// arrives just before it. It applies ONLY where the harmony actually moves —
// anticipating a chord that is not changing is just an early note.

import { TICKS_PER_QUARTER, type NoteEvent } from '../../core/notes';
import { diatonicTriad, nearestVoicing } from '../../core/harmony';
import { SHAPES, shapeForStyle } from '../../core/chord-rhythms';
import type { Progression } from '../../arranger/progression';
import { chordSpans, type PartOptions } from '../part-types';

/** Half a beat. Enough to be heard as a lean rather than as a mistake, and a
 *  division of the BEAT rather than of the bar, so it means the same thing in a
 *  meter that is not four. */
const ANTICIPATION = TICKS_PER_QUARTER / 2;

const DOWNBEAT_VELOCITY = 112;
const OFFBEAT_VELOCITY = 92;

export function renderComp(progression: Progression, o: PartOptions): NoteEvent[] {
  const shape = SHAPES[shapeForStyle(o.style)];
  const stepTicks = o.barTicks / 16;
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;

  chordSpans(progression, o.barTicks).forEach((span, ci) => {
    const triad = nearestVoicing(diatonicTriad(span.degree, o.octaveBase, o.key, o.scale), prev);
    prev = triad;
    const bars = Math.round(span.ticks / o.barTicks);
    const spanEnd = span.start + span.ticks;

    for (let bar = 0; bar < bars; bar++) {
      const barStart = span.start + bar * o.barTicks;
      for (const hit of shape) {
        let start = barStart + hit.stepOffset * stepTicks;
        let duration = hit.durationSteps * stepTicks;
        // The lean: the FIRST hit of a chord that is not the progression's
        // first, and only in that chord's first bar. Held longer by as much as
        // it moved, so the chord still ends where it would have.
        if (bar === 0 && hit.stepOffset === 0 && ci > 0) {
          start -= ANTICIPATION;
          duration += ANTICIPATION;
        }
        if (start >= spanEnd) continue;
        const velocity = hit.stepOffset === 0 ? DOWNBEAT_VELOCITY : OFFBEAT_VELOCITY;
        for (const midi of triad) {
          out.push({ start, duration: Math.min(duration, spanEnd - start), midi, velocity });
        }
      }
    }
  });
  return out;
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`, expect clean.

- [ ] **Step 3: Pin it with tests**

Create `src/harmony/parts/comp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER } from '../../core/notes';
import type { Progression } from '../../arranger/progression';
import { renderComp } from './comp';

const BAR = TICKS_PER_QUARTER * 4;
// 'trance' maps to 'eighths', which has a hit on step 0 — the one anticipation moves.
const o = { key: 9, scale: 'minor' as const, style: 'trance' as const, barTicks: BAR, octaveBase: 48 };
const PROG: Progression = [{ degree: 0, bars: 1 }, { degree: 5, bars: 1 }];

describe('renderComp', () => {
  it('plays chords, not single notes', () => {
    const out = renderComp(PROG, o);
    expect(out.filter((n) => n.start === out[0].start).length).toBeGreaterThan(1);
  });

  it('anticipates a chord CHANGE — something lands before the bar line', () => {
    const out = renderComp(PROG, o);
    expect(out.some((n) => n.start < BAR && n.start > BAR - TICKS_PER_QUARTER)).toBe(true);
  });

  it('does NOT anticipate the first chord — there is nothing to arrive ahead of', () => {
    expect(Math.min(...renderComp(PROG, o).map((n) => n.start))).toBe(0);
  });

  it('does not anticipate a chord that simply continues', () => {
    // Two bars of ONE chord: no change at bar 2, so every note stays on the grid.
    const out = renderComp([{ degree: 0, bars: 2 }], o);
    expect(out.filter((n) => n.start % (BAR / 16) !== 0).length).toBe(0);
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/harmony/parts/comp.test.ts` — expect 4 passing.

- [ ] **Step 4: Commit**

```bash
git add src/harmony/parts/comp.ts src/harmony/parts/comp.test.ts
git commit -m "feat(harmony): the comp leans into a chord change

The anticipation is the whole reason this is not the old renderChordComp
with better voicing. A chord that lands exactly on the bar line every
single time is what makes generated accompaniment sound generated; a
player arrives just before the change.

Only where the harmony actually MOVES. Anticipating a chord that is not
changing is not a lean, it is an early note — so a chord held across two
bars gets nothing, and neither does the first chord."
```

---

### Task 5: The arp — a real arpeggio, in the session's key

**Files:**
- Create: `src/harmony/parts/arp.ts`
- Test: `src/harmony/parts/arp.test.ts` (create, at the end)

**Produces:** `renderArp(p: Progression, o: PartOptions): NoteEvent[]`

**Why this is not the `arp` note-FX:** `src/notefx/arp-processor.ts` does not arpeggiate a chord. `buildPool` takes ONE root and walks a hardcoded scale table of its own (`pentMinor` by default), unrelated to the session's key — so two notes played together become two independent scale walks, and it can leave the key without noticing. Two of its patterns call `Math.random()`.

- [ ] **Step 1: Write it**

```ts
// The arp: the chord's own notes, one at a time, up.
//
// Not to be confused with the `arp` note-FX, which is a different thing under
// the same name: that one takes ONE root and walks a hardcoded scale of its own
// (pentatonic minor by default, unrelated to the session's key), so two notes
// played together come out as two independent scale walks and it can leave the
// key without noticing. Two of its patterns call Math.random().
//
// This walks the CHORD TONES of the inferred progression, in the session's key,
// and gives the same answer every time — which it must, because the offline
// render has to match what you heard.

import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';
import { diatonicTriad } from '../../core/harmony';
import type { Progression } from '../../arranger/progression';
import { chordSpans, type PartOptions } from '../part-types';

const ARP_VELOCITY = 96;

export function renderArp(progression: Progression, o: PartOptions): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const span of chordSpans(progression, o.barTicks)) {
    // Root position every chord, NOT voice-led. An arpeggio is heard as a line,
    // and inverting it to sit near the previous chord would put that line's
    // contour at the mercy of a rule written for stacked voicings.
    const tones = diatonicTriad(span.degree, o.octaveBase, o.key, o.scale);
    const steps = Math.max(1, Math.round(span.ticks / TICKS_PER_STEP));
    for (let i = 0; i < steps; i++) {
      const start = span.start + i * TICKS_PER_STEP;
      out.push({
        start,
        duration: Math.min(TICKS_PER_STEP, span.start + span.ticks - start),
        midi: tones[i % tones.length],
        velocity: ARP_VELOCITY,
      });
    }
  }
  return out;
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`, expect clean.

- [ ] **Step 3: Pin it with tests**

Create `src/harmony/parts/arp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, TICKS_PER_STEP } from '../../core/notes';
import { diatonicTriad } from '../../core/harmony';
import type { Progression } from '../../arranger/progression';
import { renderArp } from './arp';

const BAR = TICKS_PER_QUARTER * 4;
const o = { key: 9, scale: 'minor' as const, style: 'lo-fi' as const, barTicks: BAR, octaveBase: 60 };
const PROG: Progression = [{ degree: 0, bars: 1 }];

describe('renderArp', () => {
  it('plays one note at a time', () => {
    const byStart = new Map<number, number>();
    for (const n of renderArp(PROG, o)) byStart.set(n.start, (byStart.get(n.start) ?? 0) + 1);
    for (const count of byStart.values()) expect(count).toBe(1);
  });

  it('uses only the chord tones — never a scale walk from the root', () => {
    const tones = new Set(diatonicTriad(0, o.octaveBase, o.key, o.scale).map((m) => m % 12));
    for (const n of renderArp(PROG, o)) expect(tones.has(n.midi % 12)).toBe(true);
  });

  it('fills the chord rather than stopping after one pass', () => {
    expect(renderArp(PROG, o).length).toBe(BAR / TICKS_PER_STEP);
  });

  it('is deterministic — the same progression twice gives the same notes', () => {
    expect(renderArp(PROG, o)).toEqual(renderArp(PROG, o));
  });

  it('follows the progression from chord to chord', () => {
    const out = renderArp([{ degree: 0, bars: 1 }, { degree: 4, bars: 1 }], o);
    const fifth = new Set(diatonicTriad(4, o.octaveBase, o.key, o.scale).map((m) => m % 12));
    for (const n of out.filter((x) => x.start >= BAR)) expect(fifth.has(n.midi % 12)).toBe(true);
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/harmony/parts/arp.test.ts` — expect 5 passing.

- [ ] **Step 4: Commit**

```bash
git add src/harmony/parts/arp.ts src/harmony/parts/arp.test.ts
git commit -m "feat(harmony): an arp that arpeggiates a chord

Not the arp note-FX, which does something else under the same name: it
takes one root and walks a hardcoded scale of its own, unrelated to the
session's key, so two notes played together become two independent scale
walks and it can leave the key without noticing.

This walks the chord tones of the inferred progression, in the session's
key, and gives the same answer twice — which it must, because the
offline render has to match what was heard.

Root position every chord and deliberately not voice-led: an arpeggio is
heard as a line, and inverting it to sit near the previous chord puts
that line's contour at the mercy of a rule written for stacked voicings."
```

---

### Task 6: `renderPart` — the one door

**Files:**
- Create: `src/harmony/render-part.ts`
- Test: `src/harmony/render-part.test.ts` (create, at the end)

**Produces:** `renderPart(role: LaneRole | undefined, p: Progression, o: PartOptions): NoteEvent[]`

- [ ] **Step 1: Write it**

```ts
// Which renderer plays a progression, given what part the lane plays.
//
// A table rather than a switch, so adding a role is a line here and a file in
// parts/ — and so the absent cases are visible as absent rather than hidden in
// a default branch.

import type { LaneRole } from '@loom/plugin-sdk';
import type { NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import type { PartOptions, PartRenderer } from './part-types';
import { renderPad } from './parts/pad';
import { renderBass } from './parts/bass';
import { renderComp } from './parts/comp';
import { renderArp } from './parts/arp';

/** Partial on purpose: `melody` is not here, and its absence is the answer.
 *  A lane marked Melody is the thing being accompanied, not an accompaniment. */
const RENDERERS: Partial<Record<LaneRole, PartRenderer>> = {
  pad: renderPad,
  bass: renderBass,
  comp: renderComp,
  arp: renderArp,
};

export function renderPart(
  role: LaneRole | undefined, progression: Progression, o: PartOptions,
): NoteEvent[] {
  // An unmarked lane plays nothing rather than falling back to a part nobody
  // chose. `laneRoleOf` already answers undefined for a percussion lane, so
  // this is also what stops a drum lane from being handed chords.
  if (!role || progression.length === 0) return [];
  return RENDERERS[role]?.(progression, o) ?? [];
}
```

- [ ] **Step 2: Pin it with tests**

Create `src/harmony/render-part.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { renderPart } from './render-part';
import { renderPad } from './parts/pad';

const BAR = TICKS_PER_QUARTER * 4;
const o = { key: 9, scale: 'minor' as const, style: 'lo-fi' as const, barTicks: BAR, octaveBase: 48 };
const PROG: Progression = [{ degree: 0, bars: 1 }];

describe('renderPart', () => {
  it('routes a role to its renderer', () => {
    expect(renderPart('pad', PROG, o)).toEqual(renderPad(PROG, o));
  });

  it('gives every accompanying role something to play', () => {
    for (const role of ['bass', 'comp', 'pad', 'arp'] as const) {
      expect(renderPart(role, PROG, o).length).toBeGreaterThan(0);
    }
  });

  it('a MELODY lane accompanies nothing', () => {
    expect(renderPart('melody', PROG, o)).toEqual([]);
  });

  it('an unmarked lane accompanies nothing rather than guessing', () => {
    expect(renderPart(undefined, PROG, o)).toEqual([]);
  });

  it('an empty progression is silence, not a default chord', () => {
    expect(renderPart('pad', [], o)).toEqual([]);
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/harmony/` — expect every file in the directory green.

- [ ] **Step 3: Commit**

```bash
git add src/harmony/render-part.ts src/harmony/render-part.test.ts
git commit -m "feat(harmony): one door from a role to a part

A table rather than a switch, so the absent cases are visible as absent
instead of hidden in a default branch. melody is not in it, and that
absence is the answer: a lane marked Melody is the thing being
accompanied, not an accompaniment.

An unmarked lane plays nothing rather than falling back to a part nobody
chose — which is also what keeps a percussion lane out, since laneRoleOf
already answers undefined for one."
```

---

### Task 7: `createFollowSource` — inference and rendering as a cached source

**Files:**
- Create: `src/harmony/follow-source.ts`
- Test: `src/harmony/follow-source.test.ts` (create, at the end)

**Produces:** `FollowDeps`, `createFollowSource(deps): WeaveSource`, `progressionFor(deps): Chord[]`

- [ ] **Step 1: Write it**

```ts
// A follower lane's notes, as the same kind of source WEAVE hands the scheduler.
//
// Deliberately the shape of `WeaveSource` — a function of no arguments,
// returning what the lane plays this iteration — because that is the shape
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
import type { WeaveSource } from '../weave/weave-runtime';
import { inferChords } from './infer-chords';
import { renderPart } from './render-part';

export interface FollowDeps {
  /** What the LEADER plays this iteration: its launched clip's notes, or its
   *  own weave source when the leader is itself weaving. Undefined ⇒ the leader
   *  is gone or silent. */
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
}

/** A cheap fingerprint of a note list.
 *
 *  Over start and pitch, not the whole event: those are the two fields the
 *  analysis reads, so a velocity edit on the leader is genuinely not a reason
 *  to re-derive. O(n) once per iteration — the same order the fold beside it
 *  already costs. */
function fingerprint(notes: readonly NoteEvent[]): number {
  let h = notes.length;
  for (const n of notes) h = (h * 31 + n.start + n.midi * 7) | 0;
  return h;
}

/** The progression this lane is playing — written if the user wrote one, else
 *  inferred from the leader. Exported because the chord bar draws exactly this,
 *  and deriving it a second time there is how a readout ends up naming one
 *  chord while the music plays another. */
export function progressionFor(deps: FollowDeps): Chord[] {
  const written = deps.written();
  if (written && written.length > 0) return written.map((c) => ({ ...c }));
  const notes = deps.leaderNotes() ?? [];
  if (notes.length === 0) return [];
  const { key, scale } = deps.tonality();
  return inferChords(notes, { key, scale, barTicks: deps.barTicks(), bars: deps.bars() });
}

export function createFollowSource(deps: FollowDeps): WeaveSource {
  let cacheKey = '';
  let out: NoteEvent[] = [];

  return () => {
    const notes = deps.leaderNotes() ?? [];
    const role = deps.role();
    const { key, scale } = deps.tonality();
    const written = deps.written();
    const next = [
      fingerprint(notes), role ?? '-', key, scale, deps.style(),
      deps.barTicks(), deps.bars(), deps.octaveBase(),
      written ? written.map((c) => `${c.degree}:${c.bars}`).join(',') : '-',
    ].join('|');

    if (next !== cacheKey) {
      cacheKey = next;
      out = renderPart(role, progressionFor(deps), {
        key, scale, style: deps.style(),
        barTicks: deps.barTicks(), octaveBase: deps.octaveBase(),
      });
    }
    return out;
  };
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`, expect clean.

- [ ] **Step 3: Pin it with tests**

Create `src/harmony/follow-source.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { createFollowSource, type FollowDeps } from './follow-source';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, duration: number, midi: number): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });

const deps = (over: Partial<FollowDeps> = {}): FollowDeps => ({
  leaderNotes: () => [n(0, BAR, 57)],
  role: () => 'pad',
  tonality: () => ({ key: 9, scale: 'minor' }),
  style: () => 'lo-fi',
  barTicks: () => BAR,
  bars: () => 1,
  octaveBase: () => 48,
  written: () => undefined,
  ...over,
});

describe('createFollowSource', () => {
  it('produces notes for a lane with a leader and a role', () => {
    expect(createFollowSource(deps())()!.length).toBeGreaterThan(0);
  });

  it('produces nothing when the leader is silent', () => {
    expect(createFollowSource(deps({ leaderNotes: () => [] }))()).toEqual([]);
  });

  it('produces nothing when the lane has no role', () => {
    expect(createFollowSource(deps({ role: () => undefined }))()).toEqual([]);
  });

  it('re-derives when the leader changes', () => {
    let notes = [n(0, BAR, 57)];
    const src = createFollowSource(deps({ leaderNotes: () => notes }));
    const before = src()!.map((x) => x.midi);
    notes = [n(0, BAR, 60), n(BAR / 2, BAR / 2, 64)];
    expect(src()!.map((x) => x.midi)).not.toEqual(before);
  });

  it('does NOT re-derive when nothing changed — the cache holds', () => {
    const src = createFollowSource(deps());
    expect(src()).toBe(src());       // reference identity, deliberately
  });

  it('a written progression wins over the inferred one', () => {
    const written: Progression = [{ degree: 3, bars: 1 }];
    expect(createFollowSource(deps({ written: () => written }))()!.map((x) => x.midi))
      .not.toEqual(createFollowSource(deps())()!.map((x) => x.midi));
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/harmony/follow-source.test.ts` — expect 6 passing.

- [ ] **Step 4: Commit**

```bash
git add src/harmony/follow-source.ts src/harmony/follow-source.test.ts
git commit -m "feat(harmony): a follower's notes, shaped like a weave source

The same shape WEAVE hands the scheduler, on purpose: that is the shape
notesFor already resolves and ctx.notes already accepts, and a second
hook in lane-scheduler for the same job would be a second answer to what
does this lane play — the thing this feature exists to avoid.

Cached on a fingerprint of everything the answer depends on, because it
runs on the scheduler's tick. The fingerprint covers start and pitch and
not the whole event, so a velocity edit on the leader is genuinely not a
reason to re-derive.

progressionFor is exported because the chord bar draws exactly it.
Deriving it a second time there is how a readout ends up naming one
chord while the music plays another."
```

---

### Task 8: Wire it into `notesFor`, and make weave and follow exclusive

**Files:**
- Modify: `src/app/weave-wiring.ts` (the `build` function, around line 182)
- Test: `src/app/follow-wiring.test.ts` (create, at the end)

- [ ] **Step 1: Read the surrounding code first**

Open `src/app/weave-wiring.ts`. Read `build` (from line 182) and `rawFor` / `foldFor` (from line 302). `build` decides what a lane's source IS; `rawFor` and `foldFor` wrap it with the time-scale, progression, octave and leader-guard folds. A follower must be returned from `build` so it inherits those wrappers exactly as a weave does.

Note what `notesOf(laneId)` returns for a lane id that is not present — the follow source needs `undefined` there.

- [ ] **Step 2: Return a follow source from `build`**

Add near the top of the file:

```ts
import { createFollowSource } from '../harmony/follow-source';
import { laneRoleOf } from '../session/lane-role';
import { resolveTonality } from '../session/session';

/** Where a follower's part sits. Middle C's octave: the bass drops below it and
 *  the pad and comp sit on it, so all four parts land in a usable register
 *  without asking the user for a number before they have heard anything. */
const FOLLOW_OCTAVE_BASE = 48;
```

At the top of `build`, BEFORE `const sel = state.lanes[laneId]?.weave;`:

```ts
    // Follow is checked FIRST and returns outright. Both this and the weave
    // selection answer "what does this lane play", and the two cannot both be
    // right — so one wins rather than the two being merged, and the inspector
    // clears the weave when you pick a leader.
    const lane = deps.getSession().lanes.find((l) => l.id === laneId);
    if (lane?.follow) {
      const leaderId = lane.follow.leaderId;
      return createFollowSource({
        leaderNotes: () => notesOf(leaderId),
        role: () => laneRoleOf(lane),
        tonality: () => resolveTonality(lane, deps.getSession()),
        style: () => deps.getSession().musicality?.style ?? 'acid-techno',
        barTicks: () => ticksPerBar(deps.getMeter()),
        bars: () => barsOfLeader(leaderId),
        octaveBase: () => FOLLOW_OCTAVE_BASE,
        written: () => lane.follow?.chords,     // undefined until Task 10
      });
    }
```

Add a small local `barsOfLeader(id: string): number` that reads the leader's launched clip's `lengthBars`, defaulting to 1 when there is no clip. Use whatever accessor this file already has for a lane's current clip — do not invent one.

`deps.getSession()` is the accessor name used elsewhere in this file; confirm it and use the real one.

- [ ] **Step 3: Typecheck and run the existing weave tests**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/app/weave-wiring.test.ts`
Expected: clean, and every existing weave test still green — a lane with no `follow` must behave exactly as before.

- [ ] **Step 4: Pin it with tests**

Create `src/app/follow-wiring.test.ts`. Copy the harness from `src/app/weave-wiring.test.ts` — its state fixture and how it constructs the wiring — rather than inventing one. Assert:

- a lane that follows gets notes even with no weave selection;
- follow WINS over a weave selection on the same lane (a pad over one chord is a single stack at tick 0; the weave would give the loop's own rhythm);
- a lane following a lane that is gone plays nothing rather than throwing.

Run: `NO_COLOR=1 npx vitest run src/app/follow-wiring.test.ts` — expect green.

- [ ] **Step 5: Commit**

```bash
git add src/app/weave-wiring.ts src/app/follow-wiring.test.ts
git commit -m "feat(follow): a following lane reaches the scheduler

Through notesFor, the door WEAVE already uses, so a follower inherits
the same time-scale, progression and octave folds a woven lane gets and
the scheduler learns nothing new.

Follow is checked first and returns outright. Both it and a weave
selection answer what does this lane play, and the two cannot both be
right — so one wins outright rather than the two being merged."
```

---

### Task 9: Count the triggers through the real transport

**Files:**
- Test: `src/app/follow-scheduling.test.ts` (create)

**Why this task exists:** `src/weave/weave-runtime.ts:6` records that WEAVE's first shape passed every isolated test while the lane fell silent in the real transport. A follower can fail in exactly that way — every unit test green, no notes reaching the scheduler. **Do not skip this one.** It is not a TDD ceremony; it is the only check that looks at the thing end to end.

- [ ] **Step 1: Read the precedent**

Open `src/app/weave-scheduling.test.ts` end to end. It drives the real transport with a fake clock and counts `onTrigger` calls per lane. Reuse its harness verbatim; only the fixture changes.

- [ ] **Step 2: Write the test**

Three cases, using that file's helpers:

- a following pad lane fires notes over one bar, with a melodic leader holding a bar of notes;
- a follower whose leader is gone stays silent rather than throwing;
- the leader fires exactly the same count whether or not it is being followed — the follower reads it and must never write to it.

- [ ] **Step 3: Run it**

Run: `NO_COLOR=1 npx vitest run src/app/follow-scheduling.test.ts`

If it fails, that is the point of the task. Debug from the TRANSPORT end, not the unit end — the unit tests are already green and will keep telling you everything is fine.

- [ ] **Step 4: Confirm the whole app directory is green**

Run: `NO_COLOR=1 npx vitest run src/app/`

- [ ] **Step 5: Commit**

```bash
git add src/app/follow-scheduling.test.ts
git commit -m "test(follow): count the triggers through the real transport

Every isolated test can pass while nothing reaches the scheduler. That
is not hypothetical: it is how WEAVE's first shape shipped, silent, with
a full green suite behind it.

Also pins that the leader is unchanged by being followed — the follower
reads it and must never write to it."
```

---

### Task 10: The Follow control, and the chord bar

**Files:**
- Create: `src/session/follow-eligible.ts`
- Modify: `src/session/session-inspector.ts`, `src/session/session-types.ts`, `src/app/weave-wiring.ts`
- Modify: `plugins/weave/…` — find the chord bar by grepping `plugins/weave/` for `chordNow`
- Test: `src/session/follow-eligible.test.ts` (create, at the end)

- [ ] **Step 1: Write `src/session/follow-eligible.ts`**

```ts
// Which lanes a follower may be pointed at.
//
// Its own file, and pure, because the dropdown is not the only thing that needs
// the answer: the loader drops a dangling leader, and anything that OFFERS a
// leader must offer the same set the loader would keep. Two copies of this rule
// is how you get a dropdown offering a lane the loader then discards.

import type { SessionLane } from './session-types';
import { isHarmonic } from '../plugins/capabilities';

export function eligibleLeaders(
  lanes: readonly SessionLane[], followerId: string,
): SessionLane[] {
  return lanes.filter((l) =>
    // Not itself: a lane following itself would ask itself for its own notes.
    l.id !== followerId
    // Harmonic only: a percussion note picks a voice, not a pitch, so there is
    // no harmony in it to read.
    && isHarmonic(l.engineId)
    // Not a follower: allowing a chain means allowing a cycle, and a cycle is
    // an infinite derivation on the scheduler's tick. One level, no exceptions.
    && !l.follow,
  );
}
```

- [ ] **Step 2: Add `chords` to the follow field**

In `session-types.ts`, replace the `follow` declaration with:

```ts
  follow?: {
    leaderId: string;
    /** The progression, corrected by hand. Present ⇒ it wins over what the
     *  analysis inferred — the same precedence `activeProgression` applies to a
     *  written progression over a picked one. Absent is the ordinary case. */
    chords?: import('../arranger/progression').Chord[];
  };
```

- [ ] **Step 3: Build the control in the inspector**

Open `src/session/session-inspector.ts` and find the section that renders the lane's role control. Add a Follow row beside it, built the same way: a `<select>` from `eligibleLeaders(state.lanes, lane.id)` plus a "—" option meaning "not following". On change, route the mutation through the same `withUndo` wrapper the neighbouring role control uses:

```ts
withUndo(() => {
  if (!leaderId) delete lane.follow;
  // Setting a leader clears the weave: they are exclusive, and clearing it HERE
  // is what makes "follow is checked first" in build a statement about the data
  // rather than a tie-break the user cannot see.
  else { lane.follow = { leaderId }; delete lane.weave; }
});
```

Guard it exactly as the role control is guarded — `laneRoleOf` answers `undefined` for a drum lane, so a drum lane must not show this row.

- [ ] **Step 4: Draw it in the chord bar**

Grep `plugins/weave/` for `chordNow` to find the file that draws the chord bar. Give it the follower's progression through the panel context, read-only first; then let a click write `follow.chords`, edited with the existing pure ops in `src/arranger/chord-track.ts` (`setDegree`, `setLength`, `insertAfter`, `removeAt`) — they are already non-mutating, which is what a panel that repaints mid-read needs.

**⚠ The panel is a PLUGIN and has NO hot reload.** After every edit under `plugins/weave/`: `npm run build:plugins` AND a full page reload. Vite serves `public/` as static bytes and will happily keep serving the old panel. "My change isn't showing" is this, nearly every time.

**⚠ Do not call `refresh()` from a control that MOVES.** It remounts the panel and destroys the element the pointer is holding — a click survives, a drag dies on the second event. This has shipped twice as "the fader can't be dragged".

- [ ] **Step 5: Build and typecheck**

Run: `npm run build:plugins && npx tsc --noEmit` — both clean.

- [ ] **Step 6: Look at it in a browser**

Run `npm run dev` in the worktree. Create two lanes, put notes on one, set the other to follow it, mark it Pad, press play. Confirm **by ear** that chords sound and that they change when you edit the melody. This step is not optional: a UI feature is not done because its tests pass.

- [ ] **Step 7: Pin the pure part with tests**

Create `src/session/follow-eligible.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eligibleLeaders } from './follow-eligible';

const lane = (id: string, engineId = 'subtractive', extra = {}) =>
  ({ id, engineId, clips: [], inserts: [], ...extra }) as never;

describe('eligibleLeaders', () => {
  it('offers the other melodic lanes', () => {
    expect(eligibleLeaders([lane('a'), lane('b')], 'b').map((l) => l.id)).toEqual(['a']);
  });

  it('never offers the lane itself', () => {
    expect(eligibleLeaders([lane('a')], 'a')).toEqual([]);
  });

  it('never offers a drum lane — there is no harmony to read', () => {
    expect(eligibleLeaders([lane('d', 'drums-machine'), lane('b')], 'b')).toEqual([]);
  });

  it('never offers a lane that already follows — no chains, no cycles', () => {
    const lanes = [lane('a', 'subtractive', { follow: { leaderId: 'c' } }), lane('b')];
    expect(eligibleLeaders(lanes, 'b')).toEqual([]);
  });
});
```

Run: `NO_COLOR=1 npx vitest run src/session/follow-eligible.test.ts` — expect 4 passing.

- [ ] **Step 8: Commit**

```bash
git add src/session/follow-eligible.ts src/session/follow-eligible.test.ts src/session/session-inspector.ts src/session/session-types.ts src/app/weave-wiring.ts plugins/weave public/plugins
git commit -m "feat(follow): choose a leader, and correct what it inferred

eligibleLeaders is its own pure file because the dropdown is not the
only thing that needs the answer — the loader drops a dangling leader
and has to keep exactly the set the dropdown offered. Two copies of that
rule is a dropdown offering a lane the loader then discards.

No chains: a lane that already follows cannot be a leader. Allowing a
chain means allowing a cycle, and a cycle is an infinite derivation on
the scheduler's tick.

Picking a leader clears the lane's weave, which is what makes follow
winning in build a statement about the data rather than a tie-break the
user cannot see."
```

---

### Task 11: Full suite, and the docs

**Files:** `CLAUDE.md`, the spec's status line

- [ ] **Step 1: Build everything**

Run: `npm run build`

**This must run before the e2e suite.** `test:e2e` serves `dist/` with no build step, so skipping it tests a stale bundle and the new feature "fails" for no reason.

- [ ] **Step 2: Run the full suite**

Run: `npm test`

If `test:unit` exits non-zero with `ERR_IPC_CHANNEL_CLOSED` *after* every test reports passing, that is the known flaky teardown — re-run to confirm.

- [ ] **Step 3: Add `src/harmony/` to CLAUDE.md**

In the Architecture section, after the `src/weave/` entry:

```markdown
- **[src/harmony/](src/harmony/)** — a lane that plays what another lane implies. `infer-chords` reads a leading lane's notes and returns the same `Chord[]` a hand-written progression uses — weighted by metric position TIMES duration (which is why there is no separate passing-note rule: a passing tone is already the small number), with inertia so the harmony stops moving on a one-vote margin, and a cadence preference on the last bar that only exists because the analysis reads AHEAD. `parts/` is one renderer per `LaneRole` and `render-part` the one door; the comp's anticipation — entering half a beat before a chord CHANGE, and only a change — is what separates it from the old `renderChordComp`. `follow-source` wraps both in the shape of a `WeaveSource`, so the whole feature reaches the scheduler through `weave-wiring`'s `notesFor` and `lane-scheduler` learns nothing new. **Follow and weave are exclusive**: both answer "what does this lane play", `build` checks follow first, and the inspector clears the weave when you pick a leader. Pure — no DOM, no `AudioContext`, no module state, and no `Math.random()`, because the offline render must match what you heard.
```

- [ ] **Step 4: Mark the spec shipped**

Change the spec's `Status:` line to `Status: shipped`, with the commit range beneath it.

- [ ] **Step 5: Commit and rebase**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-15-follower-lane-accompaniment-design.md
git commit -m "docs(harmony): record the follower lane in the architecture

States the two things a future reader would otherwise re-derive from the
tests: why there is no separate passing-note rule (the weighting already
is one), and why follow and weave are exclusive rather than composed."
git fetch origin && git rebase main && npm test
```

Report the result. **Do NOT merge to main** — that is the user's call, always.

---

## Coverage check

| Spec section | Task |
| --- | --- |
| 1. `lane.follow` data + load tolerance | 1 |
| 2. Analysis: weight, inertia, cadence | 2 |
| 3. Parts: pad, bass | 3 |
| 3. Parts: comp + anticipation | 4 |
| 3. Parts: arp | 5 |
| 3. Parts: the dispatcher | 6 |
| 4. The hook, cached like the weave source | 7 |
| 4. Resolved through `notesFor` | 8 |
| 5. Weave/follow exclusive | 8 (data) + 10 (UI clears it) |
| 6. Inferred progression visible and editable | 10 |
| 7. UI: leader dropdown, no self, no cycles | 10 |
| Verification: real transport | 9 |
| Constraints | Global Constraints; Task 5 restates the no-`Math.random()` one |

**Known gaps, deliberate:**

- **Task 8's `barsOfLeader`** and the exact `deps.getSession()` accessor are described rather than written, because both depend on names that must be read in place. A guess here would be worse than an instruction to look.
- **Task 10's chord-bar file** is named by how to find it (`grep plugins/weave/ for chordNow`) for the same reason. The editing ops it uses already exist and are named.
- The user's parked idea — **the follower's own clip supplying the rhythm** — is deliberately not in this plan. The spec does not include it and the accompaniment works without it. It is the first place to go if the result sounds mechanical.
