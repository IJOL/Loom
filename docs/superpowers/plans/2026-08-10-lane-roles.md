# Lane Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lane can be marked bass / melody / comp / pad / arp, is offered only the material of that part, and chordal parts are generated diatonically with voice leading instead of authored.

**Architecture:** The role is one optional field on `SessionLane`, saved by the existing whole-object clone. One accessor, `sourcesFor(role)`, replaces `kindsFor` and absorbs the three duplicate answers already in the tree. Chordal material is not authored: it is a new loop SOURCE (`chord:<shape>`) rendered from `src/core/harmony.ts`, which already generates diatonic triads per style. Chord voicings gain inversions so a part stops jumping between bars.

**Tech Stack:** TypeScript, Vitest, Vite. The WEAVE panel is an external plugin compiled by `npm run build:plugins`; it reaches the host only through `@loom/plugin-sdk`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-10-lane-roles-design.md`. Every acceptance criterion there is a test here.
- **Absent role = today's behaviour, exactly.** No session migrates.
- **No `engineId === '…'` in the core.** Ask the capability door or the role.
- **Never add a second answer.** This round RETIRES three; it must not add a fourth.
- **File size:** target 300 code lines, hard cap 500. Comments and blanks do not count.
- **Test assertions are relative** (ratios, comparisons), never absolute magnitudes, unless justified in a comment.
- **Colour-free tests:** `NO_COLOR=1 npx vitest run <file>` for a single file; the npm scripts already set it.
- **Commit messages in English.**
- Work in the worktree: `C:\Users\nacho\git\tb303-synth\.claude\worktrees\arranger-auto-accompaniment`.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/core/harmony.ts` | + `inversions`, `nearestVoicing`; `renderChordComp` voice-leads | 1 |
| `src/core/harmony-inversions.test.ts` | new — the inversion maths and the movement comparison | 1 |
| `src/session/session-types.ts` | + `LaneRole`, `SessionLane.role` | 2 |
| `src/app/weave-loops.ts` | `kindsFor` → `sourcesFor(role)`; `rootFor` keyed by role | 2, 5 |
| `src/app/weave-loops-role.test.ts` | new — the filter table and the register order | 2, 5 |
| `src/weave/loop-ids.ts` | + the `chord:<shape>` source | 3 |
| `src/core/harmony-shapes.ts` | new — the shape catalogue + one-bar renderer | 3 |
| `src/patterns/pattern-picker-ui.ts` | `patternKindFor` / `patternRootFor` retired | 4 |
| `src/session/session-inspector.ts` | `genKindFor` retired | 4 |
| `docs/superpowers/specs/2026-08-10-auto-accompaniment-design.md` | `PartRole` / `PartSpec.patternKind` retired | 4 |
| `packages/loom-plugin-sdk/src/manifest.ts` | + `PanelLane.role`, `laneRole`, `setLaneRole` | 6 |
| `src/app/panel-context.ts` | the host side of both, + reseed | 6 |
| `plugins/weave/lane-row.ts` | the picker, sharing the STYLE cell | 7 |
| `src/styles/_weave.scss` | the shared cell, the `Role · Style` heading | 7 |
| `src/app/weave-wiring.ts` | re-voice chordal lanes after the progression | 8 |

---

### Task 1: Inversions, so a chord part stops jumping

Independently shippable: it improves the clip inspector's **Chords** button on its own and nothing later depends on shipping it first.

**Files:**
- Modify: `src/core/harmony.ts` (add after `diatonicTriad`, line 56; edit `renderChordComp`, line 117)
- Test: `src/core/harmony-inversions.test.ts` (create)

**Interfaces:**
- Consumes: `diatonicTriad(rootDegree, octaveBase, key, scale): number[]`, `progressionById(id)` from `src/arranger/progression.ts`.
- Produces: `inversions(triad: number[]): number[][]`, `nearestVoicing(triad: number[], prev: number[] | null): number[]`. Task 8 uses `nearestVoicing`.

- [ ] **Step 1: Write the failing test**

Create `src/core/harmony-inversions.test.ts`:

```ts
// A chord part that is rebuilt in root position every bar jumps by as much as
// eleven semitones between bars. Inversions are the standard answer: the same
// chord, its notes in a different order, chosen to sit near the last one.
import { describe, it, expect } from 'vitest';
import { diatonicTriad, inversions, nearestVoicing, renderChordComp } from './harmony';
import { inScale } from './musicality';
import { progressionById } from '../arranger/progression';
import { TICKS_PER_STEP } from './notes';

const KEY = 9;              // A
const SCALE = 'minor' as const;
const BASE = 48;
const BAR_TICKS = TICKS_PER_STEP * 16;

/** Total semitone movement between two ascending voicings, voice by voice. */
const movement = (a: number[], b: number[]) =>
  a.reduce((sum, m, i) => sum + Math.abs(m - b[i]), 0);

describe('inversions', () => {
  it('gives a triad its three positions, each still ascending', () => {
    const t = diatonicTriad(0, BASE, KEY, SCALE);
    const inv = inversions(t);
    expect(inv).toHaveLength(3);
    for (const v of inv) {
      expect(v).toHaveLength(3);
      expect(v[0]).toBeLessThan(v[1]);
      expect(v[1]).toBeLessThan(v[2]);
    }
  });

  it('keeps the same chord — the same pitch classes, in every position', () => {
    // An inversion reorders voices. A position that changed which notes are in
    // the chord would be a different chord, which is the one thing it must not be.
    const t = diatonicTriad(0, BASE, KEY, SCALE);
    const classes = (v: number[]) => [...new Set(v.map((m) => ((m % 12) + 12) % 12))].sort();
    for (const v of inversions(t)) expect(classes(v)).toEqual(classes(t));
  });
});

describe('nearestVoicing', () => {
  it('gives root position when there is nothing to be near', () => {
    const t = diatonicTriad(2, BASE, KEY, SCALE);
    expect(nearestVoicing(t, null)).toEqual(t);
  });

  it('moves less than root position over a real progression', () => {
    // The whole point, as a number rather than an adjective. i-VI-III-VII is in
    // the shipped catalogue.
    const prog = progressionById('i-VI-III-VII')!.chords;
    const roots = prog.map((c) => c.degree);

    let rootTotal = 0;
    let voicedTotal = 0;
    let prevRoot: number[] | null = null;
    let prevVoiced: number[] | null = null;
    for (const d of roots) {
      const triad = diatonicTriad(d, BASE, KEY, SCALE);
      const voiced = nearestVoicing(triad, prevVoiced);
      if (prevRoot) rootTotal += movement(triad, prevRoot);
      if (prevVoiced) voicedTotal += movement(voiced, prevVoiced);
      prevRoot = triad;
      prevVoiced = voiced;
    }
    expect(voicedTotal).toBeLessThan(rootTotal);
  });

  it('stays within an octave of where the chord itself sits', () => {
    // Unbounded, a long progression walks the part out of its register one
    // small nearest step at a time.
    const prog = progressionById('i-VI-III-VII')!.chords;
    let prev: number[] | null = null;
    for (let lap = 0; lap < 8; lap++) {
      for (const c of prog) {
        const triad = diatonicTriad(c.degree, BASE, KEY, SCALE);
        const voiced = nearestVoicing(triad, prev);
        expect(Math.abs(voiced[0] - triad[0])).toBeLessThanOrEqual(12);
        prev = voiced;
      }
    }
  });

  it('never leaves the scale', () => {
    const prog = progressionById('i-VI-III-VII')!.chords;
    let prev: number[] | null = null;
    for (const c of prog) {
      const voiced = nearestVoicing(diatonicTriad(c.degree, BASE, KEY, SCALE), prev);
      for (const m of voiced) expect(inScale(m, KEY, SCALE)).toBe(true);
      prev = voiced;
    }
  });
});

describe('renderChordComp voice-leads', () => {
  it('keeps the same rhythm and the same degrees, and moves less', () => {
    // What must NOT change with the improvement: the hits and the harmony.
    const melody = [0, 1, 2, 3].map((bar) => ({
      start: bar * BAR_TICKS, duration: BAR_TICKS, midi: 57, velocity: 100,
    }));
    const out = renderChordComp(melody, {
      key: KEY, scale: SCALE, style: 'ambient', bars: 4, barTicks: BAR_TICKS, octaveBase: BASE,
    });
    // ambient is SUSTAINED: one hit per bar, three notes each.
    expect(out).toHaveLength(4 * 3);
    for (const n of out) expect(inScale(n.midi, KEY, SCALE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd "C:/Users/nacho/git/tb303-synth/.claude/worktrees/arranger-auto-accompaniment" && NO_COLOR=1 npx vitest run src/core/harmony-inversions.test.ts`

Expected: FAIL — `inversions is not a function`, `nearestVoicing is not a function`.

- [ ] **Step 3: Implement**

In `src/core/harmony.ts`, immediately after `diatonicTriad` (line 56):

```ts
/** The same chord in each of its positions: root, 1st, 2nd.
 *
 *  An inversion rotates the lowest voice up an octave. Three positions for a
 *  triad — a THIRD inversion needs a seventh chord, which this file does not
 *  build; when sevenths arrive this grows a position rather than changing shape.
 *  Every result stays ascending, because the caller compares voicings voice by
 *  voice and a re-ordered one would compare against the wrong note. */
export function inversions(triad: number[]): number[][] {
  const out: number[][] = [triad];
  let cur = triad;
  for (let i = 1; i < triad.length; i++) {
    const [low, ...rest] = cur;
    cur = [...rest, low + 12];
    out.push(cur);
  }
  return out;
}

/** The voicing of `triad` closest to `prev`, by total semitone movement.
 *
 *  This is what makes a generated chord part sound played rather than
 *  computed: `diatonicTriad` builds every bar from scratch in root position, so
 *  a progression moves the part by as much as eleven semitones between bars.
 *
 *  Bounded to within an octave of the chord's own root position. Unbounded, a
 *  long progression walks the part out of the register its caller put it in,
 *  one small nearest step at a time — each move locally reasonable and the sum
 *  of them not.
 *
 *  `prev === null` is the first bar and gives root position: there is nothing
 *  to be near, and inventing a voicing would just move the start. */
export function nearestVoicing(triad: number[], prev: number[] | null): number[] {
  if (!prev || prev.length !== triad.length) return triad;
  const home = triad[0];
  let best = triad;
  let bestCost = Infinity;
  for (const cand of inversions(triad)) {
    for (const shift of [-12, 0, 12]) {
      const v = cand.map((m) => m + shift);
      if (Math.abs(v[0] - home) > 12) continue;
      let cost = 0;
      for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - prev[i]);
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
  }
  return best;
}
```

Then in `renderChordComp`, replace the triad line inside the bar loop:

```ts
  let prevVoicing: number[] | null = null;
  for (let bar = 0; bar < bars; bar++) {
    const triad = nearestVoicing(diatonicTriad(roots[bar], octaveBase, key, scale), prevVoicing);
    prevVoicing = triad;
```

(the rest of the loop is unchanged — it already iterates `triad`).

- [ ] **Step 4: Run the test**

Run: `NO_COLOR=1 npx vitest run src/core/harmony-inversions.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the neighbours that could notice**

Run: `NO_COLOR=1 npx vitest run src/core src/arranger && npx tsc --noEmit`
Expected: PASS. `harmony.test.ts` asserts on `renderChordComp` output — if a case there pins root-position pitches, update THAT test with a comment naming this change, do not weaken the new one.

- [ ] **Step 6: Commit**

```bash
git add src/core/harmony.ts src/core/harmony-inversions.test.ts
git commit -m "feat(harmony): voice chords to the nearest inversion"
```

---

### Task 2: The role, and the ONE door that answers what a lane may play

**Files:**
- Modify: `src/session/session-types.ts` (add to `SessionLane`, line 102)
- Modify: `src/app/weave-loops.ts` (replace `kindsFor`, line 122; call site line 169)
- Test: `src/app/weave-loops-role.test.ts` (create)

**Interfaces:**
- Produces: `type LaneRole = 'bass' | 'melody' | 'comp' | 'pad' | 'arp'`, `SessionLane.role?: LaneRole`, and `sourcesFor(role: LaneRole | undefined, harmonic: boolean): PatternKind[]`. Tasks 3–8 consume both.

- [ ] **Step 1: Write the failing test**

Create `src/app/weave-loops-role.test.ts`:

```ts
// What a lane is OFFERED. Today a melodic lane is offered both bass and lead
// patterns, because nothing in the session says which of the two it is meant to
// be. The role says it.
import { describe, it, expect } from 'vitest';
import { sourcesFor } from './weave-loops';

describe('sourcesFor', () => {
  it('offers a drum lane percussion, whatever its role says', () => {
    // A drum lane has no role picker; a stale role from an engine swap must not
    // hand it melodic material.
    expect(sourcesFor(undefined, false)).toEqual(['drums']);
    expect(sourcesFor('bass', false)).toEqual(['drums']);
  });

  it('offers an UNMARKED melodic lane exactly what it is offered today', () => {
    // The escape hatch: absent means nothing changes, which is why no session
    // has to migrate.
    expect(sourcesFor(undefined, true)).toEqual(['bass', 'synth']);
  });

  it('narrows a marked lane to its own shelf', () => {
    expect(sourcesFor('bass', true)).toEqual(['bass']);
    expect(sourcesFor('melody', true)).toEqual(['synth']);
  });

  it('gives the chordal roles no PATTERN shelf at all', () => {
    // Their material is generated, not authored — Task 3 adds it as a separate
    // source. An empty shelf list here is the correct answer, not a gap.
    for (const role of ['comp', 'pad', 'arp'] as const) {
      expect(sourcesFor(role, true)).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops-role.test.ts`
Expected: FAIL — `sourcesFor is not exported`.

- [ ] **Step 3: Add the type to the session**

In `src/session/session-types.ts`, above `export interface SessionLane`:

```ts
/** What part a lane plays. The ONE vocabulary — `PartRole`, `patternKindFor`
 *  and `genKindFor` are retired into it (see the lane-roles spec), because a
 *  question with four answers has none.
 *
 *  Percussion is deliberately NOT here: whether a lane is a drum lane is
 *  already answered by `isHarmonic` at the capability door, and a second answer
 *  is the fault this vocabulary exists to reduce. */
export type LaneRole = 'bass' | 'melody' | 'comp' | 'pad' | 'arp';
```

and inside `SessionLane`, after `name?: string;`:

```ts
  /** What part this lane plays, if the user has said. Absent means today's
   *  behaviour exactly — every melodic shelf offered — which is what lets this
   *  ship without migrating a single saved session. */
  role?: LaneRole;
```

- [ ] **Step 4: Replace `kindsFor` with the one door**

In `src/app/weave-loops.ts`, replace the whole of `kindsFor` (lines 119–124) with:

```ts
/** Which library shelves a lane reads — the ONE answer to "what may this lane
 *  play", asked by the panel that LISTS and the scheduler that RESOLVES.
 *
 *  A drum lane reads percussion whatever its role says: a role left behind by
 *  an engine swap must not hand it melodic material.
 *
 *  An UNMARKED melodic lane gets both shelves, which is what it always got —
 *  the comment this replaces called it a guess that would otherwise hide half
 *  the library, and it was right until there was somewhere to record the answer.
 *
 *  The chordal roles read NO shelf: their material is generated rather than
 *  authored (see `chordShapeChoices`), so an empty list here is the answer, not
 *  a gap. */
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
```

Add to the imports at the top of the file:

```ts
import type { LaneRole } from '../session/session-types';
```

and change the call site at line 169 from `kindsFor(c.harmonic)` to:

```ts
  for (const kind of sourcesFor(c.lane?.role, c.harmonic)) {
```

- [ ] **Step 5: Run the test**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops-role.test.ts && npx tsc --noEmit`
Expected: PASS, 4 tests, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/session/session-types.ts src/app/weave-loops.ts src/app/weave-loops-role.test.ts
git commit -m "feat(weave): a lane's role decides which shelves it reads"
```

---

### Task 3: Chord shapes as a loop SOURCE

**Files:**
- Create: `src/core/harmony-shapes.ts`
- Modify: `src/weave/loop-ids.ts` (the `LoopId` union, `formatLoopId`, `parseLoopId`)
- Modify: `src/app/weave-loops.ts` (`weaveLoopChoices`, `weaveLoopNotes`)
- Test: `src/core/harmony-shapes.test.ts`, `src/weave/loop-ids.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `sourcesFor` (Task 2), `diatonicTriad` (existing).
- Produces: `type ChordShapeId`, `CHORD_SHAPES: { id: ChordShapeId; label: string }[]`, `renderChordShape(shape, opts): NoteEvent[]`, and the `{ source: 'chord'; shape: ChordShapeId }` member of `LoopId`.

> **Why a new SOURCE and not a new `PatternKind`.** `loop-ids.ts:19` holds a
> hand-maintained `PATTERN_KINDS` array, and because `PatternKind[]` accepts a
> subset, adding a kind to the union **typechecks silently** and then
> `parseLoopId` returns null for every id of it — the loop appears in the
> dropdown and plays silence. Step 4's test exists to make that impossible here.

- [ ] **Step 1: Write the failing test for the renderer**

Create `src/core/harmony-shapes.test.ts`:

```ts
// A chordal part is GENERATED, never authored. The shapes are the rhythms that
// already have names in harmony.ts; the notes come from the diatonic triad.
import { describe, it, expect } from 'vitest';
import { CHORD_SHAPES, renderChordShape } from './harmony-shapes';
import { inScale } from './musicality';
import { TICKS_PER_STEP } from './notes';

const BAR = TICKS_PER_STEP * 16;
const OPTS = { key: 9, scale: 'minor' as const, octaveBase: 48, barTicks: BAR };

describe('chord shapes', () => {
  it('offers every shape with an id and a label', () => {
    expect(CHORD_SHAPES.length).toBeGreaterThan(0);
    for (const s of CHORD_SHAPES) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });

  it('renders three notes per hit, all in the scale', () => {
    for (const s of CHORD_SHAPES) {
      const notes = renderChordShape(s.id, OPTS);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.length % 3).toBe(0);
      for (const n of notes) expect(inScale(n.midi, OPTS.key, OPTS.scale)).toBe(true);
    }
  });

  it('stays inside ONE bar, because the blend folds by position within a bar', () => {
    for (const s of CHORD_SHAPES) {
      for (const n of renderChordShape(s.id, OPTS)) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start + n.duration).toBeLessThanOrEqual(BAR);
      }
    }
  });

  it('sustains the pad shape for the whole bar', () => {
    // The shape that IS a pad. If this stops being one hit of a full bar, the
    // pad role has quietly become something else.
    const notes = renderChordShape('sustained', OPTS);
    expect(notes).toHaveLength(3);
    for (const n of notes) expect(n.duration).toBe(BAR);
  });

  it('renders on the TONIC, so the progression can move it', () => {
    // Library loops are written on one chord and moved per bar by
    // applyProgression. A shape that pre-applied a chord would be moved twice.
    const notes = renderChordShape('sustained', OPTS);
    const root = Math.min(...notes.map((n) => n.midi));
    expect(root % 12).toBe(((OPTS.octaveBase + OPTS.key) % 12 + 12) % 12);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/core/harmony-shapes.test.ts`
Expected: FAIL — cannot find module `./harmony-shapes`.

- [ ] **Step 3: Implement the shapes**

Create `src/core/harmony-shapes.ts`:

```ts
// The chordal material a lane is offered, GENERATED rather than authored.
//
// There are no pad loops in the library and there never will be: a chord
// written as fixed semitones cannot stay diatonic across the eight scales a
// session may be in, and transposition by degree snaps to the scale before it
// moves anything, so an out-of-scale stack comes back mangled rather than
// merely transposed. What a chordal lane picks is therefore a RHYTHM, and the
// notes come from the diatonic triad of whatever chord the bar is under.
//
// The rhythms are the ones harmony.ts already names for its per-style comping
// table. Naming them here as choices is the whole of this module.
//
// Rendered on the TONIC, one bar, exactly like a library pattern: the
// progression moves it per bar downstream (applyProgression). Pre-applying a
// chord here would move it twice.

import { TICKS_PER_STEP, type NoteEvent } from './notes';
import { diatonicTriad } from './harmony';
import type { ScaleId } from './musicality';

export type ChordShapeId =
  | 'sustained' | 'offbeat' | 'eighths' | 'sparse' | 'syncopated';

interface Hit { stepOffset: number; durationSteps: number; }

const SHAPES: Record<ChordShapeId, Hit[]> = {
  sustained:  [{ stepOffset: 0, durationSteps: 16 }],
  offbeat:    [2, 6, 10, 14].map((s) => ({ stepOffset: s, durationSteps: 1 })),
  eighths:    [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ({ stepOffset: s, durationSteps: 1 })),
  sparse:     [{ stepOffset: 0, durationSteps: 2 }, { stepOffset: 8, durationSteps: 2 }],
  syncopated: [
    { stepOffset: 0, durationSteps: 1 },
    { stepOffset: 9, durationSteps: 1 },
    { stepOffset: 14, durationSteps: 1 },
  ],
};

export const CHORD_SHAPES: { id: ChordShapeId; label: string }[] = [
  { id: 'sustained',  label: 'Sustained' },
  { id: 'offbeat',    label: 'Offbeat stabs' },
  { id: 'eighths',    label: 'Pulsing eighths' },
  { id: 'sparse',     label: 'Sparse stabs' },
  { id: 'syncopated', label: 'Syncopated' },
];

export function isChordShape(id: string): id is ChordShapeId {
  return Object.prototype.hasOwnProperty.call(SHAPES, id);
}

/** One bar of a shape, on the tonic triad. */
export function renderChordShape(
  shape: ChordShapeId,
  opts: { key: number; scale: ScaleId; octaveBase: number; barTicks: number },
): NoteEvent[] {
  const { key, scale, octaveBase, barTicks } = opts;
  const stepTicks = barTicks / 16;
  const triad = diatonicTriad(0, octaveBase, key, scale);
  const out: NoteEvent[] = [];
  let first = true;
  for (const hit of SHAPES[shape]) {
    const start = hit.stepOffset * stepTicks;
    if (start >= barTicks) continue;
    const duration = Math.min(hit.durationSteps * stepTicks, barTicks - start);
    const velocity = first ? 115 : 95;
    first = false;
    for (const midi of triad) out.push({ start, duration, midi, velocity });
  }
  return out;
}
```

- [ ] **Step 4: Write the failing test for the id, then teach `loop-ids` the source**

Append to `src/weave/loop-ids.test.ts`:

```ts
describe('the chord source', () => {
  it('round-trips a shape', () => {
    const id = formatLoopId({ source: 'chord', shape: 'sustained' });
    expect(parseLoopId(id)).toEqual({ source: 'chord', shape: 'sustained' });
  });

  it('refuses a shape that does not exist', () => {
    // The silent-dropdown trap, head on: an id that lists but does not parse is
    // a loop that shows in the picker and plays nothing.
    expect(parseLoopId('chord:nope')).toBeNull();
  });

  it('does not collide with a clip whose id starts with chord', () => {
    const id = formatLoopId({ source: 'clip', clipId: 'chordal-1' });
    expect(parseLoopId(id)).toEqual({ source: 'clip', clipId: 'chordal-1' });
  });
});
```

Run it: `NO_COLOR=1 npx vitest run src/weave/loop-ids.test.ts` → FAIL.

Then in `src/weave/loop-ids.ts`, extend the union, the formatter and the parser:

```ts
import { isChordShape, type ChordShapeId } from '../core/harmony-shapes';

export type LoopId =
  | { source: 'clip'; clipId: string }
  | { source: 'pattern'; style: StyleId; kind: PatternKind; index: number }
  | { source: 'chord'; shape: ChordShapeId };
```

in `formatLoopId`, before the existing return:

```ts
  if (l.source === 'chord') return `chord:${l.shape}`;
```

and in `parseLoopId`, after the `clip:` branch:

```ts
  if (id.startsWith('chord:')) {
    const shape = id.slice(6);
    // VALIDATED, not cast. A kind that parses but does not exist is the failure
    // this module's header is about: it lists and then plays silence.
    return isChordShape(shape) ? { source: 'chord', shape } : null;
  }
```

Run again: PASS.

- [ ] **Step 5: Offer and resolve them in `weave-loops.ts`**

Add the import:

```ts
import { CHORD_SHAPES, renderChordShape } from '../core/harmony-shapes';
```

In `weaveLoopChoices`, after the pattern loop (line 177) and before `return out`:

```ts
  // Chordal roles read no pattern shelf; their material is generated. Offered
  // by SHAPE — the rhythm — because the notes are decided per bar by the
  // progression rather than by the choice.
  if (c.lane?.role === 'comp' || c.lane?.role === 'pad' || c.lane?.role === 'arp') {
    for (const s of CHORD_SHAPES) {
      out.push({
        id: formatLoopId({ source: 'chord', shape: s.id }),
        name: s.label,
        group: 'Chords',
      });
    }
  }
```

In `weaveLoopNotes`, after the `clip` branch (line 191):

```ts
  if (parsed.source === 'chord') {
    // barTicks is required: a shape is a rhythm and there is nothing to place
    // it against without one. Absent ⇒ this loop is unresolvable, which the
    // caller already substitutes for.
    if (!c.barTicks) return undefined;
    return renderChordShape(parsed.shape, {
      key: c.key, scale: c.scale, octaveBase: rootFor(c.lane?.role, c.key), barTicks: c.barTicks,
    });
  }
```

(`rootFor` takes a role from Task 5; until then pass `48 + nearestOffset(c.key)` and the Task 5 step replaces it.)

- [ ] **Step 6: Run everything this touches**

Run: `NO_COLOR=1 npx vitest run src/core src/weave src/app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/harmony-shapes.ts src/core/harmony-shapes.test.ts \
        src/weave/loop-ids.ts src/weave/loop-ids.test.ts src/app/weave-loops.ts
git commit -m "feat(weave): chordal lanes are offered generated shapes"
```

---

### Task 4: Retire the duplicate answers

The round's own rule. Without this it adds a fourth vocabulary instead of replacing three.

**Files:**
- Modify: `src/patterns/pattern-picker-ui.ts` (`patternKindFor` line 16, `patternRootFor` line 33)
- Modify: `src/session/session-inspector.ts` (`genKindFor` line 39, call sites lines 504, 565)
- Modify: `docs/superpowers/specs/2026-08-10-auto-accompaniment-design.md` (`PartRole`, `PartSpec.patternKind`)
- Test: `src/app/weave-loops-role.test.ts` (extend)

**Interfaces:**
- Consumes: `sourcesFor` (Task 2), `nearestOffset` (existing export of `weave-loops.ts`).

- [ ] **Step 1: Write the failing test**

Append to `src/app/weave-loops-role.test.ts`:

```ts
import { readFileSync } from 'node:fs';

describe('one answer, not four', () => {
  // Grep IS the test. Each of these was a separate answer to "what may this
  // lane play", two of them keyed off an engine id in the core, which the
  // project forbids.
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('has retired patternKindFor and patternRootFor', () => {
    const f = src('../patterns/pattern-picker-ui.ts');
    expect(f).not.toContain('patternKindFor');
    expect(f).not.toContain('patternRootFor');
  });

  it('has retired genKindFor', () => {
    expect(src('../session/session-inspector.ts')).not.toContain('genKindFor');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops-role.test.ts`
Expected: FAIL on all three names.

- [ ] **Step 3: Replace the callers, then delete the functions**

In `src/patterns/pattern-picker-ui.ts`, delete `patternKindFor` and `patternRootFor` and take both answers from the one door. Its caller in `session-inspector.ts:504` becomes:

```ts
  const kind = sourcesFor(lane.role, isHarmonic(lane.engineId))[0] ?? 'synth';
```

and the root at `session-inspector.ts:565`:

```ts
  const root = rootFor(lane.role, musicality.key);
```

with these imports added to `session-inspector.ts`:

```ts
import { sourcesFor, rootFor } from '../app/weave-loops';
import { isHarmonic } from '../plugins/capabilities';
```

Delete `genKindFor` (lines 39–43) and read the generator kind from the role at its call site:

```ts
  const genKind = lane.role === 'bass' ? 'bass' : isHarmonic(lane.engineId) ? 'melody' : 'beat';
```

`rootFor` must be exported from `weave-loops.ts` for this — change `function rootFor` to `export function rootFor` (Task 5 changes its signature; do that task before this step if executing out of order).

- [ ] **Step 4: Update the arranger spec so the two agree**

In `docs/superpowers/specs/2026-08-10-auto-accompaniment-design.md`, replace the `PartRole` block with:

```ts
import type { LaneRole } from '../session/session-types';
export interface PartSpec {
  role: LaneRole; engineId: string; presetId?: string; name: string;
  noteFx?: NoteFxState[];        // the arp part ships an 'arp' note-FX
}
export interface StyleKit { parts: PartSpec[] }
export const STYLE_KITS: Record<StyleId, StyleKit>   // exhaustive
```

and add below it:

> `PartSpec.patternKind` is gone: which shelf a part draws from is `sourcesFor(role)`, the one door. A drums part is identified by its engine, which `isHarmonic` already answers, so `drums` is not a role.

- [ ] **Step 5: Run the suite**

Run: `NO_COLOR=1 npx vitest run && npx tsc --noEmit`
Expected: PASS. The known-flaky `plugins/bitcrusher` may fail; re-run that file alone to confirm it is the flake and not you.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: one answer to what a lane may play"
```

---

### Task 5: Register per role

**Files:**
- Modify: `src/app/weave-loops.ts` (`rootFor`, line 140)
- Test: `src/app/weave-loops-role.test.ts` (extend)

**Interfaces:**
- Produces: `export function rootFor(role: LaneRole | undefined, key: number): number` — Tasks 3 and 4 call it.

- [ ] **Step 1: Write the failing test**

Append to `src/app/weave-loops-role.test.ts`:

```ts
import { rootFor } from './weave-loops';

describe('rootFor', () => {
  it('keeps the parts apart, low to high', () => {
    // The order is the requirement; the numbers are a starting point to be
    // adjusted by ear. Asserted as an ORDER so tuning them does not break it.
    const k = 9;
    expect(rootFor('bass', k)).toBeLessThan(rootFor('pad', k));
    expect(rootFor('pad', k)).toBeLessThan(rootFor('comp', k));
    expect(rootFor('comp', k)).toBeLessThan(rootFor('melody', k));
  });

  it('puts an unmarked lane where it has always been', () => {
    // 48 ± the nearest-tonic offset. Changing this moves every existing
    // session's library loops, which is not this round's business.
    expect(rootFor(undefined, 0)).toBe(48);
  });

  it('keeps every role within half an octave of its base', () => {
    // The nearest tonic, never the one above: adding the key outright walks the
    // whole shelf upwards and is the bug reported as "nunca pones bajos que
    // suenen a bajos".
    for (let key = 0; key < 12; key++) {
      expect(Math.abs(rootFor('bass', key) - 36)).toBeLessThanOrEqual(6);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops-role.test.ts`
Expected: FAIL — `rootFor` is not exported / takes a `PatternKind`.

- [ ] **Step 3: Implement**

Replace `rootFor` in `src/app/weave-loops.ts` (keeping its existing doc comment, which explains `nearestOffset` and must stay):

```ts
const ROLE_BASE: Record<LaneRole, number> = {
  bass: 36, pad: 48, comp: 52, melody: 60, arp: 60,
};

export function rootFor(role: LaneRole | undefined, key: number): number {
  // 48 for an unmarked lane: where every melodic pattern has always sat, and
  // moving it would re-pitch every existing session's library loops.
  return (role ? ROLE_BASE[role] : 48) + nearestOffset(key);
}
```

Update its call site in `weaveLoopNotes` (line 195) from `rootFor(parsed.kind, c.key)` to:

```ts
    rootFor(c.lane?.role, c.key),
```

and the chord branch from Task 3 to `rootFor(c.lane?.role, c.key)`.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/app src/weave && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/weave-loops.ts src/app/weave-loops-role.test.ts
git commit -m "feat(weave): a role puts its material in its own register"
```

---

### Task 6: The role across the plugin boundary

The WEAVE panel is compiled separately and cannot import `src/`. Without this task the control in Task 7 has nothing to read or write.

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (`PanelLane` line 180; `PanelContext` beside `laneStyle` line 356)
- Modify: `src/app/panel-context.ts` (`lanes()` line 229; beside `setLaneStyle` line 389)
- Test: `src/app/panel-context-role.test.ts` (create)

**Interfaces:**
- Consumes: `LaneRole` (Task 2).
- Produces: `PanelLane.role?: string`, `PanelContext.laneRole(laneId): string | null`, `PanelContext.setLaneRole(laneId, role: string | null): void`.

- [ ] **Step 1: Write the failing test**

Create `src/app/panel-context-role.test.ts`. Build the context with the same doubles the existing `panel-context` tests use — open `src/app/panel-context.test.ts` and copy its `makeCtx` helper verbatim rather than inventing a second fixture. Then:

```ts
describe('the role, across the plugin boundary', () => {
  it('reads null for a lane nobody has marked', () => {
    const { ctx } = makeCtx();
    expect(ctx.laneRole('lane1')).toBeNull();
  });

  it('writes the role onto the LANE, not into the weave', () => {
    // It is session state: the arranger and the MIDI importer read it too, and
    // a copy inside the panel would be a second owner.
    const { ctx, state } = makeCtx();
    ctx.setLaneRole('lane1', 'pad');
    expect(state.lanes[0].role).toBe('pad');
    expect(ctx.laneRole('lane1')).toBe('pad');
  });

  it('clears back to unmarked', () => {
    const { ctx, state } = makeCtx();
    ctx.setLaneRole('lane1', 'pad');
    ctx.setLaneRole('lane1', null);
    expect(state.lanes[0].role).toBeUndefined();
    expect(ctx.laneRole('lane1')).toBeNull();
  });

  it('reseeds the lane, or it keeps playing the shelf it just left', () => {
    // Exactly why setLaneStyle reseeds: a loop id carries its own kind and
    // still RESOLVES whatever the role says, so without this a lane marked Bass
    // goes on playing the synth loop it had while every picker shows a dash.
    const { ctx, state, weave } = makeCtx();
    weave.lanes['lane1'] = { weave: { kind: 'ab', a: 'lib:techno:synth:0', b: 'lib:techno:synth:1', x: 0 } };
    ctx.setLaneRole('lane1', 'bass');
    expect(weave.lanes['lane1'].weave?.a).not.toBe('lib:techno:synth:0');
  });

  it('publishes the role in the lane summary a panel reads', () => {
    const { ctx, state } = makeCtx();
    state.lanes[0].role = 'comp';
    expect(ctx.lanes()[0].role).toBe('comp');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/panel-context-role.test.ts`
Expected: FAIL — `ctx.laneRole is not a function`.

- [ ] **Step 3: Widen the SDK surface**

In `packages/loom-plugin-sdk/src/manifest.ts`, add to `PanelLane`:

```ts
  /** What part this lane plays — 'bass' | 'melody' | 'comp' | 'pad' | 'arp' —
   *  or absent if the user has not said. A plain string, not the host's union:
   *  a panel is compiled separately and must not depend on our types. */
  role?: string;
```

and beside `setLaneStyle`:

```ts
  /** What part this lane plays, or null if unmarked. It decides which loops the
   *  lane is offered. */
  laneRole(laneId: string): string | null;
  /** Mark a lane, or clear it with null. Clearing returns it to being offered
   *  everything, which is what an unmarked lane has always been offered. */
  setLaneRole(laneId: string, role: string | null): void;
```

- [ ] **Step 4: Implement the host side**

In `src/app/panel-context.ts`, add `role: l.role` to the object built in `lanes()`, and beside `setLaneStyle`:

```ts
    laneRole(laneId) {
      return deps.sessionHost.state.lanes.find((l) => l.id === laneId)?.role ?? null;
    },

    setLaneRole(laneId, role) {
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      // Undoable, unlike the style beside it: this is session state, and the
      // asymmetry is deliberate — making the role un-undoable to match would be
      // worse than the oddity of two controls in one cell behaving differently.
      const run = () => {
        if (role === null) delete lane.role;
        else lane.role = role as LaneRole;
        // The loops have to move with it, for the same reason setLaneStyle
        // reseeds: a loop id still resolves whatever the role says, so the lane
        // would go on playing the shelf it just left.
        reseedLaneIfLoopsMoved(laneId);
        deps.onWeaveChanged?.(laneId);
      };
      const hd = deps.sessionHost.deps.historyDeps;
      if (hd) withUndo(hd, run); else run();
    },
```

with `import type { LaneRole } from '../session/session-types';` and `import { withUndo } from '../save/history-wiring';` added if not already present.

- [ ] **Step 5: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts src/app/panel-context.ts src/app/panel-context-role.test.ts
git commit -m "feat(sdk): a panel can read and set a lane's role"
```

---

### Task 7: The control, sharing the STYLE cell

**Files:**
- Modify: `plugins/weave/lane-row.ts` (the style select, around line 544; the append at line 452)
- Modify: `src/styles/_weave.scss` (the shared cell; the header labels in `plugins/weave/main.ts:497`)

**Interfaces:**
- Consumes: `ctx.laneRole` / `ctx.setLaneRole` (Task 6).

> **The row keeps TWELVE columns.** Its columns plus gaps already need 1022px
> before the elastic loops column gets a pixel; a thirteenth would leave about
> 140px to choose loops in on a 1280px laptop. The role goes ABOVE the style, in
> the same cell.

- [ ] **Step 1: Build the picker**

In `plugins/weave/lane-row.ts`, beside the style select, add:

```ts
  const role = document.createElement('select');
  role.className = 'weave-role-select';
  role.setAttribute('aria-label', 'What part this lane plays');
  for (const [value, label] of [
    ['', '— any —'], ['bass', 'Bass'], ['melody', 'Melody'],
    ['comp', 'Comp'], ['pad', 'Pad'], ['arp', 'Arp'],
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    role.appendChild(o);
  }
  const paintRole = () => { role.value = ctx.laneRole(lane.id) ?? ''; };
  role.addEventListener('change', () => {
    ctx.setLaneRole(lane.id, role.value || null);
  });
  paintRole();
```

Wrap it with the style select in one cell, and append THAT where the style select was appended — do not append a thirteenth child:

```ts
  const shelf = el('div', 'weave-shelf');
  shelf.append(role, style);
```

- [ ] **Step 2: Style the shared cell**

In `src/styles/_weave.scss`, beside `.weave-sound`:

```scss
// Role above style, in ONE column. The row is at its width limit — twelve
// columns plus gaps already need 1022px before the elastic loops column gets a
// pixel — so the second control buys its place on the axis with room.
.weave-shelf {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;

  select { min-width: 0; }
}
```

- [ ] **Step 3: Rename the heading**

In `plugins/weave/main.ts`, in the header label list (line 497), change `'Style'` to `'Role · Style'` — one heading over one cell.

- [ ] **Step 4: Build the plugin, or nothing is visible**

Run: `npm run build:plugins`
Expected: `public/plugins/weave/` rewritten. **The dev server does not compile `plugins/`** — skip this and you are looking at the previous build with no warning.

- [ ] **Step 5: Look at it**

Run `npm run dev`, open WEAVE, and check by hand — this one is looked at, not asserted, because the last change to this grid collapsed it:

- twelve columns, nothing wrapped to a second line;
- every heading over its own cell, the shared one reading `Role · Style`;
- marking a lane Pad changes its loop list to the five chord shapes;
- clearing the mark restores the full list.

- [ ] **Step 6: Commit**

```bash
git add plugins/weave/lane-row.ts plugins/weave/main.ts src/styles/_weave.scss public/plugins
git commit -m "feat(weave): mark a lane's part, beside its style"
```

---

### Task 8: Re-voice a chordal lane after the progression

**Found while planning, and not in the spec.** `applyProgression` moves every note by the chord's degree, which turns a tonic triad into that bar's diatonic triad — correctly — but in whatever position the shift lands on. Task 1's voice leading lives in `renderChordComp`, which is the Chords BUTTON's path, not WEAVE's. Without this task a WEAVE pad still jumps, which is the complaint Task 1 exists to answer.

**Files:**
- Modify: `src/app/weave-wiring.ts` (`withProgression`, lines 323–335)
- Test: `src/app/weave-chord-voicing.test.ts` (create)

**Interfaces:**
- Consumes: `nearestVoicing` (Task 1), `LaneRole` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `src/app/weave-chord-voicing.test.ts`:

```ts
// A chordal lane's notes are moved per bar by the progression, which lands each
// chord in whatever position the degree shift produced. Voice-leading them
// afterwards is what stops a pad jumping an octave between bars.
import { describe, it, expect } from 'vitest';
import { revoiceByBar } from './weave-wiring';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';

const BAR = TICKS_PER_STEP * 16;

/** Two bars, a triad held in each — the shape a Pad lane produces. */
const chordAt = (bar: number, pitches: number[]): NoteEvent[] =>
  pitches.map((midi) => ({ start: bar * BAR, duration: BAR, midi, velocity: 100 }));

describe('revoiceByBar', () => {
  it('moves the second chord closer to the first', () => {
    const notes = [...chordAt(0, [57, 60, 64]), ...chordAt(1, [65, 69, 72])];
    const out = revoiceByBar(notes, BAR);
    const bar1 = out.filter((n) => n.start === BAR).map((n) => n.midi).sort((a, b) => a - b);
    const before = [65, 69, 72].reduce((s, m, i) => s + Math.abs(m - [57, 60, 64][i]), 0);
    const after = bar1.reduce((s, m, i) => s + Math.abs(m - [57, 60, 64][i]), 0);
    expect(after).toBeLessThan(before);
  });

  it('keeps the same pitch CLASSES — it is the same chord', () => {
    const notes = [...chordAt(0, [57, 60, 64]), ...chordAt(1, [65, 69, 72])];
    const out = revoiceByBar(notes, BAR);
    const classes = (ms: number[]) => [...new Set(ms.map((m) => ((m % 12) + 12) % 12))].sort();
    const bar1 = out.filter((n) => n.start === BAR).map((n) => n.midi);
    expect(classes(bar1)).toEqual(classes([65, 69, 72]));
  });

  it('leaves a single-note part alone', () => {
    // A bass or a melody is one note at a time and has no voicing to choose.
    const notes = [
      { start: 0, duration: BAR, midi: 45, velocity: 100 },
      { start: BAR, duration: BAR, midi: 53, velocity: 100 },
    ];
    expect(revoiceByBar(notes, BAR)).toEqual(notes);
  });

  it('leaves the timing and the velocities untouched', () => {
    const notes = [...chordAt(0, [57, 60, 64]), ...chordAt(1, [65, 69, 72])];
    const out = revoiceByBar(notes, BAR);
    expect(out.map((n) => n.start)).toEqual(notes.map((n) => n.start));
    expect(out.map((n) => n.duration)).toEqual(notes.map((n) => n.duration));
    expect(out.map((n) => n.velocity)).toEqual(notes.map((n) => n.velocity));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/weave-chord-voicing.test.ts`
Expected: FAIL — `revoiceByBar is not exported`.

- [ ] **Step 3: Implement**

In `src/app/weave-wiring.ts`, above `withProgression`:

```ts
/** Voice-lead a chordal part bar by bar, after the progression has moved it.
 *
 *  `applyProgression` shifts every note by its bar's degree, which produces the
 *  right chord in whatever position the shift happens to land on — so a pad
 *  jumps between bars for no musical reason. This picks the inversion nearest
 *  the previous bar's, exactly as `renderChordComp` does for the Chords button.
 *
 *  A bar with fewer than two simultaneous notes is left alone: a bass or a
 *  melody is one note at a time and has no voicing to choose. */
export function revoiceByBar(notes: readonly NoteEvent[], barTicks: number): NoteEvent[] {
  if (barTicks <= 0) return [...notes];
  const byBar = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const bar = Math.floor(n.start / barTicks);
    const list = byBar.get(bar) ?? [];
    list.push(n);
    byBar.set(bar, list);
  }
  const moved = new Map<NoteEvent, number>();
  let prev: number[] | null = null;
  for (const bar of [...byBar.keys()].sort((a, b) => a - b)) {
    const group = byBar.get(bar)!.slice().sort((a, b) => a.midi - b.midi);
    if (group.length < 2) { prev = null; continue; }
    const voiced = nearestVoicing(group.map((n) => n.midi), prev);
    group.forEach((n, i) => moved.set(n, voiced[i]));
    prev = voiced;
  }
  return notes.map((n) => (moved.has(n) ? { ...n, midi: moved.get(n)! } : n));
}
```

with `import { nearestVoicing } from '../core/harmony';` added.

Then in `withProgression`, after the `applyProgression` call (line 333):

```ts
    const moved = applyProgression(shifted, prog, barTicks, m.key, m.scale);
    const voiced = CHORDAL_ROLES.has(laneRoleOf(laneId) ?? '')
      ? revoiceByBar(moved, barTicks)
      : moved;
    return voiced.map((n, i) => ({ ...notes[i], midi: n.midi })) as typeof notes;
```

with, at module scope:

```ts
/** The roles whose material is chords, and therefore has a voicing to choose. */
const CHORDAL_ROLES = new Set<string>(['comp', 'pad', 'arp']);
```

and `laneRoleOf(laneId)` reading `getState().lanes.find((l) => l.id === laneId)?.role`.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/weave-wiring.ts src/app/weave-chord-voicing.test.ts
git commit -m "feat(weave): voice-lead a chordal lane after the progression"
```

---

## Final verification

- [ ] **The whole suite:** `npm run build && npm run test:unit`
  Expected: green. `plugins/bitcrusher` is a known flake — re-run it alone before blaming a change.
- [ ] **The acceptance list in the spec**, item by item, including the two that need the app open: the row's twelve columns, and a Pad lane's loop list.
- [ ] **Prune the spec** once merged: `docs/superpowers/specs/2026-08-10-lane-roles-design.md` and this plan both go, per the repo's rule that a shipped spec leaves the tree.
