# Subtractive Filter Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Subtractive engine's Model x Type filter grid with one ten-entry list where every entry works, add a second filter block, and route the two with OFF / series / parallel / difference plus a Blend knob.

**Architecture:** A new pure-DSP module `src/audio-dsp/filter-stack.ts` owns both filter blocks and the routing; a sibling data module `src/audio-dsp/filter-kinds.ts` owns the ten-entry table that the dropdown and the DSP both read, so they cannot drift. `subtractive-renderer.ts` LOSES its filter code (it is at 321 code lines against a 300 target) and gains one `FilterStack` field. Filter kinds and the routing mode are structural — read once at trigger, like the filter model is today. The four new continuous params are read live by slot, so they move the note already sounding and become modulation destinations for free.

**Tech Stack:** TypeScript, Vitest, no new dependencies. The DSP primitives (`Svf` in `filter.ts`, `LadderFilter` in `ladder.ts`) are unchanged — this plan only changes who selects and combines them.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-02-subtractive-filter-stack-design.md`. Read it before Task 1.
- **Branch:** work stays on `worktree-subtractive-ringmod`, in the worktree at `.claude/worktrees/subtractive-ringmod`. Do NOT create another branch or worktree, and do NOT merge to `main` — the user merges when the whole thing is done.
- **Language:** all code, comments, labels and commit messages in **English**. No Spanish in any artifact.
- **Assertions are relative.** Ratios (`>`, `<`, `> x * 2`), never absolute magnitudes. If an absolute number is unavoidable, justify it in a comment.
- **One test per user path.** No `(or ...)` alternatives inside a test.
- **File size:** target 300 code lines, hard cap 500. Comment and blank lines do not count.
- **Every UI write of an engine param goes through `commitParam`** — not touched by this plan, but do not regress it.
- **Test colour:** run single files as `NO_COLOR=1 npx vitest run <path>`. Never add `--reporter=`.
- **Commit after every task.** Use a heredoc for the message (`git commit -F-` with `<<'EOF'`), never a PowerShell here-string.
- **Do not run `npm run test:e2e`** in this plan: it serves the last `dist/` build with no build step, and nothing here changes e2e-visible behaviour until Task 5's manual check.

---

### Task 1: The kind table and a one-block filter stack

Creates the two new modules with routing OFF only. At the end of this task nothing uses them yet — it is a self-contained, tested unit.

**Files:**
- Create: `src/audio-dsp/filter-kinds.ts`
- Create: `src/audio-dsp/filter-stack.ts`
- Test: `src/audio-dsp/filter-stack.test.ts`

**Interfaces:**
- Consumes: `Svf` from `./filter`, `LadderFilter` / `LadderTap` from `./ladder`.
- Produces:
  - `FilterKind = { value: string; label: string; model: 'dig'|'moog'|'diode'; tap: 'lp'|'hp'|'bp'|'notch' }`
  - `FILTER_KINDS: readonly FilterKind[]` (10 entries, index = param value)
  - `FILTER_KIND_OPTIONS: { value: string; label: string }[]`
  - `FILTER_ROUTING_OPTIONS: { value: string; label: string }[]`
  - `ROUTING_OFF = 0`, `ROUTING_SER = 1`, `ROUTING_PAR = 2`, `ROUTING_DIFF = 3`
  - `class FilterStack { constructor(kindA: number, kindB: number, routing: number, sr: number); update(x: number, cutA: number, resA: number, cutB: number, resB: number, blend: number): number }`
  - `trackedCutoff(baseBHz: number, aRatio: number, track: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/audio-dsp/filter-stack.test.ts`:

```ts
// src/audio-dsp/filter-stack.test.ts
import { describe, it, expect } from 'vitest';
import { FILTER_KINDS, FILTER_KIND_OPTIONS } from './filter-kinds';
import { FilterStack, ROUTING_OFF, trackedCutoff } from './filter-stack';

const SR = 48000;
const CUTOFF = 880;
// A2 (110 Hz), A5 (880 Hz), A8 (7040 Hz): three octaves under the cutoff, on it,
// three over. The same three tones the renderer's filter tests use.
const LOW = 110, AT = 880, HIGH = 7040;

/** How much of a steady sine at `hz` survives `kind`, at the engine's default
 *  resonance. The first 20 ms are dropped: the filter states start at zero, so
 *  the run-in is a transient, not the steady-state response being measured. */
const passes = (kind: number, hz: number): number => {
  const s = new FilterStack(kind, 0, ROUTING_OFF, SR);
  let acc = 0, n = 0;
  for (let i = 0; i < SR * 0.25; i++) {
    const y = s.update(Math.sin(2 * Math.PI * hz * i / SR), CUTOFF, 0.25, CUTOFF, 0.25, 0);
    if (i > SR * 0.02) { acc += y * y; n++; }
  }
  return Math.sqrt(acc / n);
};

/** A deterministic broadband signal — a seeded LCG, so every run compares the
 *  same input and two kinds differ only by what the filter did to it. */
const noise = (n: number): number[] => {
  let s = 12345;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out.push(s / 0x40000000 - 1); }
  return out;
};

const throughKind = (kind: number, input: number[]): number[] => {
  const s = new FilterStack(kind, 0, ROUTING_OFF, SR);
  return input.map((x) => s.update(x, CUTOFF, 0.4, CUTOFF, 0.4, 0));
};

const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
/** How much two renders differ, relative to their own level. Same helper the
 *  renderer tests use, and 0.01 is the threshold that file already treats as
 *  "these are the same sound". */
const divergence = (a: number[], b: number[]): number => {
  let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length / Math.max(1e-9, rms(a));
};

const kindsWithTap = (tap: string): number[] =>
  FILTER_KINDS.map((k, i) => [k, i] as const).filter(([k]) => k.tap === tap).map(([, i]) => i);

describe('the filter kind table', () => {
  it('is ten entries and the dropdown is built from it', () => {
    expect(FILTER_KINDS).toHaveLength(10);
    expect(FILTER_KIND_OPTIONS).toEqual(FILTER_KINDS.map((k) => ({ value: k.value, label: k.label })));
  });

  it('starts at the current default, so a patch that says nothing is unchanged', () => {
    expect(FILTER_KINDS[0]).toMatchObject({ model: 'dig', tap: 'lp' });
  });

  it('never offers a notch on a ladder — the one response they cannot do honestly', () => {
    // A ladder's resonance feedback fills a notch's null, and on the diode at
    // res 0.7 it inverts into a bump. The old grid let you pick that and quietly
    // handed back the lowpass; the list simply does not contain it.
    const lie = FILTER_KINDS.filter((k) => k.model !== 'dig' && k.tap === 'notch');
    expect(lie, 'a ladder notch is not an honest response').toEqual([]);
  });

  it('has unique values and unique labels', () => {
    expect(new Set(FILTER_KINDS.map((k) => k.value)).size).toBe(10);
    expect(new Set(FILTER_KINDS.map((k) => k.label)).size).toBe(10);
  });
});

describe('every entry in the list does what its label says', () => {
  it('the lowpasses pass what is under the cutoff and stop what is over it', () => {
    for (const k of kindsWithTap('lp')) {
      expect(passes(k, LOW), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, HIGH) * 10);
    }
  });

  it('the highpasses are the mirror image', () => {
    for (const k of kindsWithTap('hp')) {
      expect(passes(k, HIGH), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, LOW) * 10);
    }
  });

  it('the bandpasses pass the cutoff and reject both sides', () => {
    for (const k of kindsWithTap('bp')) {
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, LOW) * 5);
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, HIGH) * 5);
    }
  });

  it('the notch is a hole where the bandpass has its peak', () => {
    for (const k of kindsWithTap('notch')) {
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeLessThan(passes(k, LOW) * 0.2);
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeLessThan(passes(k, HIGH) * 0.2);
    }
  });
});

describe('no entry is a silent alias of another', () => {
  // This is the "everything in the list actually works" requirement as an
  // assertion: it is the test that would have caught NOTCH-on-a-ladder handing
  // back the lowpass, because the two would have been bit-identical.
  it('all ten differ from each other through the same signal', () => {
    const input = noise(SR * 0.1);
    const rendered = FILTER_KINDS.map((_, i) => throughKind(i, input));
    for (let a = 0; a < rendered.length; a++) {
      for (let b = a + 1; b < rendered.length; b++) {
        const tag = `${FILTER_KINDS[a].label} vs ${FILTER_KINDS[b].label}`;
        expect(divergence(rendered[a], rendered[b]), tag).toBeGreaterThan(0.01);
      }
    }
  });
});

describe('routing OFF', () => {
  it('is filter A alone — B is not in the path at any blend', () => {
    const input = noise(SR * 0.05);
    const run = (blend: number): number[] => {
      const s = new FilterStack(0, 3, ROUTING_OFF, SR);
      return input.map((x) => s.update(x, CUTOFF, 0.3, 200, 0.3, blend));
    };
    let d = 0;
    const a = run(0), b = run(1);
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });
});

describe('trackedCutoff', () => {
  // How far filter B follows everything that MOVES filter A (its envelope and
  // key tracking), expressed as a ratio against A's own base so the interval
  // between them is preserved in OCTAVES rather than in Hz.
  it('leaves B where its knob puts it at track 0', () => {
    expect(trackedCutoff(400, 4, 0)).toBe(400);
  });

  it('preserves the interval at track 1 — B moves by the same ratio as A', () => {
    expect(trackedCutoff(400, 4, 1)).toBe(1600);
  });

  it('follows part of the way in between', () => {
    expect(trackedCutoff(400, 3, 0.5)).toBe(800);   // 400 * (1 + 0.5*2)
  });

  it('stays inside the audible range however far A swings', () => {
    expect(trackedCutoff(400, 200, 1)).toBe(18000);
    expect(trackedCutoff(400, 0, 1)).toBe(20);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts`
Expected: FAIL — `Failed to resolve import "./filter-kinds"`.

- [ ] **Step 3: Write the kind table**

Create `src/audio-dsp/filter-kinds.ts`:

```ts
// src/audio-dsp/filter-kinds.ts
// The filter list, as data. ONE table, read by the dropdown and by the DSP that
// builds the filter — so the label and the circuit cannot drift apart.
//
// It replaces a 3x4 grid of Model x Type, two of whose twelve points were lies:
// a ladder has no honest notch (its resonance feedback fills the null, and on
// the diode model at res 0.7 the null inverts into a BUMP), so choosing NOTCH on
// MOG or 303 quietly handed back the LOWPASS. A list cannot express that: an
// entry either works or it is not in it.
//
// Duplicates ARE the point. Three lowpasses and three highpasses is not
// redundancy — 12 dB/oct state-variable, 24 dB/oct Moog ladder and 24 dB/oct
// diode ladder are three different sounds, and the label says which is which.
//
// Data only, no classes: the main-thread param spec imports this for the
// dropdown, and pulling the ladder DSP into that bundle would be a waste.

export interface FilterKind {
  /** Stable id, written into presets and saves. Never renumber; append. */
  value: string;
  /** What the dropdown shows: response, then slope, then circuit — what it does
   *  first, what it costs second, what it is made of last. */
  label: string;
  /** Which circuit: the state-variable filter, or one of the two ladders. */
  model: 'dig' | 'moog' | 'diode';
  /** Which response is taken out of it. */
  tap: 'lp' | 'hp' | 'bp' | 'notch';
}

/** Index = the `filter.kind` / `filter2.kind` param value. Index 0 is the
 *  pre-list default (DIG + LP), so a patch that never mentions the filter keeps
 *  the sound it was voiced with. */
export const FILTER_KINDS: readonly FilterKind[] = [
  { value: 'lp12dig',  label: 'LP 12 DIG',  model: 'dig',   tap: 'lp' },
  { value: 'lp24mog',  label: 'LP 24 MOG',  model: 'moog',  tap: 'lp' },
  { value: 'lp24acid', label: 'LP 24 303',  model: 'diode', tap: 'lp' },
  { value: 'hp12dig',  label: 'HP 12 DIG',  model: 'dig',   tap: 'hp' },
  { value: 'hp24mog',  label: 'HP 24 MOG',  model: 'moog',  tap: 'hp' },
  { value: 'hp24acid', label: 'HP 24 303',  model: 'diode', tap: 'hp' },
  { value: 'bp12dig',  label: 'BP 12 DIG',  model: 'dig',   tap: 'bp' },
  { value: 'bp12mog',  label: 'BP 12 MOG',  model: 'moog',  tap: 'bp' },
  { value: 'bp12acid', label: 'BP 12 303',  model: 'diode', tap: 'bp' },
  // The notch is DIG only, and deliberately last: it is the one response the
  // ladders cannot do honestly, so it has no MOG/303 siblings to sit next to.
  { value: 'notchdig', label: 'NOTCH DIG',  model: 'dig',   tap: 'notch' },
];

/** The dropdown, straight off the table. */
export const FILTER_KIND_OPTIONS = FILTER_KINDS.map((k) => ({ value: k.value, label: k.label }));

/** How filter B is wired to filter A. Index = the `filter.routing` param value.
 *  OFF is index 0 and the default: filter B is never built and never runs. */
export const FILTER_ROUTING_OPTIONS = [
  { value: 'off',  label: 'Off' },
  { value: 'ser',  label: 'Series' },
  { value: 'par',  label: 'Parallel' },
  { value: 'diff', label: 'Difference' },
];

export const ROUTING_OFF = 0;
export const ROUTING_SER = 1;
export const ROUTING_PAR = 2;
export const ROUTING_DIFF = 3;
```

- [ ] **Step 4: Write the stack (routing OFF only)**

Create `src/audio-dsp/filter-stack.ts`:

```ts
// src/audio-dsp/filter-stack.ts
// Everything the Subtractive voice knows about filtering: which circuit a kind
// selects, and how the two blocks combine.
//
// It exists so the renderer does not have to. Hand it a sample and six numbers
// and it hands a sample back; it knows nothing about notes, envelopes or params.

import { Svf } from './filter';
import { LadderFilter, type LadderTap } from './ladder';
import { FILTER_KINDS, ROUTING_OFF, type FilterKind } from './filter-kinds';

export * from './filter-kinds';

/** The cutoff rails the engine has always used: 60 * 220^x, capped at 18 kHz. */
const CUTOFF_MIN_HZ = 20;
const CUTOFF_MAX_HZ = 18000;

/**
 * Where filter B's cutoff lands, given how far filter A has moved from its own
 * base (`aRatio` = A's final cutoff / A's base cutoff — its envelope and key
 * tracking, as one number).
 *
 * MULTIPLICATIVE on purpose. Following A additively in Hz would collapse the
 * interval between the two the moment the envelope opened: B a tenth of an
 * octave over A at rest would be a hair over it at full sweep. A ratio keeps the
 * interval in OCTAVES, which is the interval you hear.
 *
 * track 0 = B is nailed where its knob puts it (a fixed high-pass under a
 * sweeping low-pass). track 1 = B moves by exactly A's ratio.
 */
export function trackedCutoff(baseBHz: number, aRatio: number, track: number): number {
  const hz = baseBHz * (1 + track * (aRatio - 1));
  return hz < CUTOFF_MIN_HZ ? CUTOFF_MIN_HZ : hz > CUTOFF_MAX_HZ ? CUTOFF_MAX_HZ : hz;
}

/** One filter: a circuit plus the response taken out of it. */
class FilterBlock {
  private svf: Svf | null = null;
  private ladder: LadderFilter | null = null;
  private readonly tap: FilterKind['tap'];

  constructor(kind: number, sr: number) {
    const k = FILTER_KINDS[Math.round(kind)] ?? FILTER_KINDS[0];
    this.tap = k.tap;
    if (k.model === 'dig') this.svf = new Svf(sr);
    // A ladder entry never declares 'notch' (filter-kinds.ts, asserted in
    // filter-stack.test.ts), so the tap is always one a ladder can take.
    else this.ladder = new LadderFilter(k.model === 'moog' ? 'moog' : 'diode', sr, k.tap as LadderTap);
  }

  update(x: number, cutoffHz: number, res: number): number {
    if (this.ladder) return this.ladder.update(x, cutoffHz, res);
    const f = this.svf!;
    f.update(x, cutoffHz, res);
    switch (this.tap) {
      case 'hp': return f.hp;
      case 'bp': return f.bp;
      case 'notch': return f.notch;
      default: return f.lp;
    }
  }
}

export class FilterStack {
  private readonly a: FilterBlock;
  /** Built only when the routing asks for it: OFF costs exactly what one filter
   *  cost before this module existed. */
  private readonly b: FilterBlock | null;
  private readonly routing: number;

  constructor(kindA: number, kindB: number, routing: number, sr: number) {
    this.routing = Math.round(routing);
    this.a = new FilterBlock(kindA, sr);
    this.b = this.routing === ROUTING_OFF ? null : new FilterBlock(kindB, sr);
  }

  /**
   * One sample through both blocks.
   * @param blend how much of B is in the result, in EVERY mode: 0 is filter A
   *              alone whatever the routing says, 1 is the mode at full.
   */
  update(x: number, cutA: number, resA: number, cutB: number, resB: number, blend: number): number {
    const a = this.a.update(x, cutA, resA);
    const b = this.b;
    if (!b) return a;                    // routing OFF: filter A alone
    return this.combine(a, x, b, cutB, resB, blend);
  }

  /** The three real routing modes. Task 3 writes their tests and then this
   *  body; until then OFF is the only mode a stack can be built in, and the
   *  three constants below are what the routing param will select. */
  private combine(
    a: number, x: number, b: FilterBlock, cutB: number, resB: number, blend: number,
  ): number {
    return a;
  }
}
```

**Stop here.** The three real modes are Task 3, which writes their tests FIRST —
that is the plan's TDD constraint, and it is why `combine` is a seam rather than
a switch you fill in now. `ROUTING_SER`, `ROUTING_PAR` and `ROUTING_DIFF` are
exported by `filter-kinds.ts` and unused in this file until then; drop them from
this file's import for now and add them back in Task 3.

- [ ] **Step 5: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts`
Expected: PASS, all tests.

If "no entry is a silent alias of another" fails for a specific pair, do NOT
lower the threshold: report which pair collided and stop. A collision means two
list entries are the same filter, which is the exact defect this work removes.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/audio-dsp/filter-kinds.ts src/audio-dsp/filter-stack.ts src/audio-dsp/filter-stack.test.ts
git commit -F- <<'EOF'
feat(subtractive): the filter list, as one table plus a stack that reads it

Ten entries, every one of which works. The Model x Type grid had twelve
points and two of them lied: a ladder has no honest notch, so NOTCH on MOG
or 303 quietly handed back the lowpass. A list cannot express that -- an
entry either works or it is not in it -- and the no-silent-alias test is
what proves it, pair by pair.

Nothing uses this yet. FilterStack only implements routing OFF, which is
filter A alone: exactly what the renderer does today.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: The renderer switches to `filter.kind`

Deletes `filter.model` and `filter.type` everywhere and moves the renderer onto
`FilterStack`. The sound does not change: this is a vocabulary swap.

**Files:**
- Modify: `src/engines/subtractive-params.ts` (delete `FILTER_MODEL_OPTIONS` / `FILTER_TYPE_OPTIONS`, add `filter.kind`)
- Modify: `src/audio-dsp/types.ts` (`SubParams`: `filterModel`/`filterType` -> `filterKind`)
- Modify: `src/audio-dsp/default-params.ts`
- Modify: `src/audio-dsp/subtractive-renderer.ts`
- Modify: `src/audio-dsp/subtractive-renderer.test.ts` (rewrite the `filter model` and `filter type` describes)
- Modify: `public/presets/subtractive.json` (6 values)
- Modify: `src/presets/subtractive-unison-presets.test.ts:40-41`
- Modify: `src/audio-dsp/live-params.dsp.test.ts:282`
- Modify: `tools/verify-defaults-unchanged.mjs`, `tools/param-access-bench.mjs`, `tools/bench-unison.mjs`

**Interfaces:**
- Consumes: `FILTER_KIND_OPTIONS`, `FilterStack`, `ROUTING_OFF` from Task 1.
- Produces: the param id `filter.kind` (discrete 0..9, default 0) and the
  `SubParams.filterKind` field, both consumed by Task 4.

- [ ] **Step 1: Write the failing test — rewrite the renderer's filter describes**

In `src/audio-dsp/subtractive-renderer.test.ts`, DELETE the whole
`describe('filter model', ...)` block (currently lines 379-423) and the whole
`describe('filter type', ...)` block (currently lines 429-600) together with the
`const LP = 0, HP = 1, BP = 2, NOTCH = 3;` line between them, and put this in
their place:

```ts
// Kind indices, from filter-kinds.ts. Named here so a test reads as a sentence.
const LP12DIG = 0, LP24MOG = 1, LP24ACID = 2, HP12DIG = 3, BP12DIG = 6, NOTCHDIG = 9;

describe('filter kind', () => {
  // One dropdown, ten entries. The engine end of it: that the renderer builds
  // the filter the kind names, and that the default is still what every preset
  // was voiced against. The per-entry response measurements live in
  // filter-stack.test.ts, where they can be made without an oscillator.
  const bag = (kind: number): ParamBag => ({
    ...DEFAULTS, 'osc1.wave': 0, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 0.4, 'filter.resonance': 0.7, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
    'filter.kind': kind,
  });
  const render = (kind: number): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), bag(kind), SR);
    const b: number[] = [];
    for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
    return b;
  };
  const divergence = (a: number[], b: number[]): number => {
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length / Math.max(1e-9, rms(a));
  };
  const mean = (b: number[]) => Math.abs(b.reduce((s, v) => s + v, 0) / b.length);

  it('defaults to LP 12 DIG, so nothing that exists today changes', () => {
    const noKind: ParamBag = { ...bag(LP12DIG) };
    delete (noKind as Record<string, number>)['filter.kind'];
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), noKind, SR);
    const b: number[] = []; for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
    expect(divergence(b, render(LP12DIG))).toBeLessThan(0.01);
  });

  it('each lowpass is audibly its own filter', () => {
    expect(divergence(render(LP12DIG), render(LP24MOG))).toBeGreaterThan(0.1);   // svf vs moog
    expect(divergence(render(LP24MOG), render(LP24ACID))).toBeGreaterThan(0.02); // moog vs diode
  });

  it('the 303 lowpass brings the asymmetry the others do not have', () => {
    expect(mean(render(LP24ACID))).toBeGreaterThan(mean(render(LP24MOG)) * 2);
  });

  it('every kind stays bounded through the engine, drive and resonance up', () => {
    // res 0.7 + drive 0.8 is a stress patch: the parallel drive feeds up to 1.8x
    // amplitude into the filter, so an analogue-style rise is EXPECTED. What must
    // not happen is a runaway, so the contract is relative: finite, bounded, and
    // drive raises the peak by a bounded ratio rather than an unbounded one.
    const peakOf = (kind: number, drive: number): number => {
      const v = new SubtractiveVoiceRenderer(
        note({ durationSec: 0.3 }), { ...bag(kind), 'filter.drive': drive }, SR,
      );
      let peak = 0;
      for (let i = 0; i < SR * 0.2; i++) { const a = Math.abs(v.renderSample(i / SR)); if (a > peak) peak = a; }
      return peak;
    };
    for (let kind = 0; kind < 10; kind++) {
      const dry = peakOf(kind, 0);
      const wet = peakOf(kind, 0.8);
      const tag = `kind ${kind}`;
      expect(Number.isFinite(wet), `${tag} went non-finite`).toBe(true);
      expect(wet, `${tag} blew up`).toBeLessThan(4.5);
      expect(wet, `${tag} drive should not reduce peak`).toBeGreaterThanOrEqual(dry);
      expect(wet / Math.max(dry, 1e-6), `${tag} drive ratio unbounded`).toBeLessThan(5);
    }
  });

  it('the notch reaches the engine — it is not the lowpass wearing a label', () => {
    expect(divergence(render(NOTCHDIG), render(LP12DIG))).toBeGreaterThan(0.1);
  });

  it('the highpass and the bandpass reach the engine too', () => {
    expect(divergence(render(HP12DIG), render(LP12DIG))).toBeGreaterThan(0.1);
    expect(divergence(render(BP12DIG), render(LP12DIG))).toBeGreaterThan(0.1);
  });
});
```

Keep the `it('the notch actually nulls, instead of merely tilting', ...)` test —
it measures the `Svf` directly and does not mention `filter.type`. Move it,
unchanged, into the new `describe('filter kind', ...)` block, and keep the `Svf`
import and the `CUTOFF_HZ` constant it needs:

```ts
  // Guards the derivation in filter.ts: the textbook `lp + hp` is structurally
  // pinned at -6 dB in this topology (its bandpass peaks at 0.5/r, not 1/r), so
  // it can never null however the resonance is set.
  it('the notch actually nulls, instead of merely tilting', () => {
    const CUTOFF_HZ = 880;
    const depthAt = (res: number, hz: number): number => {
      const s = new Svf(SR);
      let acc = 0, n = 0;
      for (let i = 0; i < SR * 0.2; i++) {
        s.update(Math.sin(2 * Math.PI * hz * i / SR), CUTOFF_HZ, res);
        if (i > SR * 0.05) { acc += s.notch * s.notch; n++; }
      }
      return Math.sqrt(acc / n);
    };
    for (const res of [0, 0.25, 0.6]) {
      expect(depthAt(res, CUTOFF_HZ), `res ${res}`).toBeLessThan(depthAt(res, CUTOFF_HZ * 8) * 0.4);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/subtractive-renderer.test.ts`
Expected: FAIL — the `filter.kind` bag renders the default lowpass for every
kind, so "the notch reaches the engine" and "the highpass and the bandpass reach
the engine too" fail (the renderer still reads `filter.model` / `filter.type`,
which the new bags do not set).

- [ ] **Step 3: Swap the param spec**

In `src/engines/subtractive-params.ts`:

Delete the `FILTER_MODEL_OPTIONS` and `FILTER_TYPE_OPTIONS` consts and their
comment blocks. Add at the top:

```ts
import { FILTER_KIND_OPTIONS } from '../audio-dsp/filter-kinds';
```

Replace the two spec entries

```ts
  { id: 'filter.model',     label: 'Model',     kind: 'discrete', min: 0, max: 2, default: 0,
    options: FILTER_MODEL_OPTIONS, group: 'filter' },
  { id: 'filter.type',      label: 'Type',      kind: 'discrete', min: 0, max: 3, default: 0,
    options: FILTER_TYPE_OPTIONS, group: 'filter' },
```

with one:

```ts
  // One list, ten entries, every one of which works — see audio-dsp/filter-kinds.ts.
  // It replaces Model x Type, a grid two of whose twelve points quietly handed
  // back the lowpass because a ladder has no honest notch.
  { id: 'filter.kind',      label: 'Type',      kind: 'discrete', min: 0, max: 9, default: 0,
    options: FILTER_KIND_OPTIONS, group: 'filter' },
```

- [ ] **Step 4: Swap the flat snapshot**

In `src/audio-dsp/types.ts`, replace these two `SubParams` lines

```ts
  filterModel: number;      // 0 = DIG (Svf), 1 = MOG ladder, 2 = 303 diode ladder
  filterType: number;       // 0 = LP, 1 = HP, 2 = BP, 3 = NOTCH
```

with:

```ts
  filterKind: number;       // index into FILTER_KINDS (audio-dsp/filter-kinds.ts)
```

In `src/audio-dsp/default-params.ts`, replace `filterModel: 0, filterType: 0,`
with `filterKind: 0,`.

- [ ] **Step 5: Move the renderer onto FilterStack**

In `src/audio-dsp/subtractive-renderer.ts`:

Replace the ladder import with the stack (keep the `Svf` import — `noiseLp` is
one):

```ts
import { Svf } from './filter';
import { FilterStack, ROUTING_OFF } from './filter-stack';
```

Delete the `ladderTapFor` helper and its comment block entirely.

In `subParamsInto`, replace

```ts
  out.filterModel = param(b, 'filter.model', 0);
  out.filterType = param(b, 'filter.type', 0);
```

with:

```ts
  out.filterKind = param(b, 'filter.kind', 0);
```

Replace the fields

```ts
  private noiseLp: Svf; private filter: Svf;
  private ladder: LadderFilter | null = null;
  private filterType: number;
```

with:

```ts
  private noiseLp: Svf;
  /** Both filter blocks and the routing between them. Built once, at trigger:
   *  a topology is not something you sweep mid-note. */
  private stack: FilterStack;
```

In the constructor, replace the filter construction

```ts
    this.filter = new Svf(sampleRate);
    const model = Math.round(p.filterModel);
    this.filterType = Math.round(p.filterType);
    if (model === 1 || model === 2) {
      this.ladder = new LadderFilter(model === 1 ? 'moog' : 'diode', sampleRate, ladderTapFor(this.filterType));
    }
```

with:

```ts
    // Filter B and the routing arrive in a later task; OFF is filter A alone.
    this.stack = new FilterStack(p.filterKind, 0, ROUTING_OFF, sampleRate);
```

Delete the whole `filterAt` method, and in `renderSample` replace

```ts
    const filtered = this.filterAt(mix, cutoff, q);
```

with:

```ts
    const filtered = this.stack.update(mix, cutoff, q, cutoff, q, 0);
```

- [ ] **Step 6: Run the renderer tests**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/subtractive-renderer.test.ts src/audio-dsp/filter-stack.test.ts`
Expected: PASS.

- [ ] **Step 7: Convert the six preset values**

In `public/presets/subtractive.json`, exactly six values change. No preset sets
both keys, so each is a one-line rename (verified 2026-08-02):

| Preset | Was | Becomes |
|--------|-----|---------|
| `BASS Wobble LFO` | `"filter.model": 1` | `"filter.kind": 1` |
| `BASS Neuro` | `"filter.model": 1` | `"filter.kind": 1` |
| `LEAD Hoover Rave` | `"filter.model": 1` | `"filter.kind": 1` |
| `BASS Hoover` | `"filter.model": 1` | `"filter.kind": 1` |
| `LEAD Razor` | `"filter.type": 2` | `"filter.kind": 6` |
| `PAD Ethereal` | `"filter.type": 1` | `"filter.kind": 3` |

Then confirm nothing is left behind:

```bash
grep -c 'filter\.model\|filter\.type' public/presets/subtractive.json
```

Expected: `0`.

- [ ] **Step 8: Update the tests and tools that named the old ids**

`src/presets/subtractive-unison-presets.test.ts`, lines 40-41:

```ts
    ['LEAD Razor', (p) => expect(p.params['filter.kind'], 'needs bandpass').toBe(6)],
    ['PAD Ethereal', (p) => expect(p.params['filter.kind'], 'needs highpass').toBe(3)],
```

`src/audio-dsp/live-params.dsp.test.ts`, line 282: `{ 'filter.model': 1 }`
becomes `{ 'filter.kind': 1 }`.

`tools/verify-defaults-unchanged.mjs`, lines 62-63:

```js
  ['MOG ladder', { ...DEFAULTS, 'filter.kind': 1 }, {}],
  ['303 diode ladder', { ...DEFAULTS, 'filter.kind': 2 }, {}],
```

and in its DEFAULTS map replace the `'filter.model': 0, 'filter.type': 0` entries
with `'filter.kind': 0`.

`tools/param-access-bench.mjs`: in the id list replace `'filter.model', 'filter.type',`
with `'filter.kind',`, and in the struct literal replace
`filterModel: Math.random(), filterType: Math.random(),` with
`filterKind: Math.random(),`.

`tools/bench-unison.mjs`, line 28: replace
`{ ...bag(voices, drift), 'filter.model': model, 'filter.type': type }` with
`{ ...bag(voices, drift), 'filter.kind': kind }`, and rename the function's
`model`/`type` parameters to a single `kind` at its call sites in that file.

- [ ] **Step 9: Run the whole unit suite and typecheck**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: typecheck silent, suite green.

If `test:unit` exits non-zero with `ERR_IPC_CHANNEL_CLOSED` AFTER all tests
report passing, that is the known flaky teardown — re-run to confirm.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat(subtractive)!: one filter list replaces the Model x Type grid

filter.model and filter.type are gone; filter.kind indexes the ten-entry
table. Every preset keeps the sound it was voiced with: the six values in
the 85 presets that named the old ids convert exactly, and no preset used
the NOTCH-on-a-ladder combination that was silently a lowpass.

The renderer LOSES its filter code to FilterStack -- ladderTapFor and its
lie, filterAt, and both filter fields -- and gains one stack field.

Old saves carrying filter.model/filter.type fall back to LP 12 DIG. That
is deliberate: this project does not do migrations.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Series, parallel and difference

Pure DSP. Fills in `FilterStack.combine`, the seam Task 1 left returning filter
A unchanged; still nothing in the engine reaches it.

**Files:**
- Modify: `src/audio-dsp/filter-stack.ts` (the `combine` body and the import)
- Test: `src/audio-dsp/filter-stack.test.ts`

**Interfaces:**
- Consumes: `FilterStack` and `ROUTING_OFF` from Task 1; `ROUTING_SER`,
  `ROUTING_PAR`, `ROUTING_DIFF` are exported by `filter-kinds.ts` and re-exported
  by `filter-stack.ts`, unused until now.
- Produces: nothing new — the routing contract these tests pin is what Task 4 wires up.

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/filter-stack.test.ts`:

```ts
describe('routing', () => {
  // Cutoffs in Hz, straight into the stack — no oscillator, no envelope.
  const CLOSED = 300, OPEN = 4000;
  const LP = 0;                      // LP 12 DIG
  const tone = (hz: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * hz * i / SR));

  /** RMS of a steady tone at `hz` through a stack, past the run-in. */
  const through = (
    routing: number, kindA: number, cutA: number, kindB: number, cutB: number,
    blend: number, hz: number,
  ): number => {
    const s = new FilterStack(kindA, kindB, routing, SR);
    const input = tone(hz, SR * 0.25);
    let acc = 0, n = 0;
    for (let i = 0; i < input.length; i++) {
      const y = s.update(input[i], cutA, 0.25, cutB, 0.25, blend);
      if (i > SR * 0.02) { acc += y * y; n++; }
    }
    return Math.sqrt(acc / n);
  };

  it('blend 0 is filter A alone, in every mode', () => {
    const solo = through(ROUTING_OFF, LP, CLOSED, LP, OPEN, 0, 440);
    for (const routing of [ROUTING_SER, ROUTING_PAR, ROUTING_DIFF]) {
      expect(through(routing, LP, CLOSED, LP, OPEN, 0, 440), `routing ${routing}`).toBeCloseTo(solo, 10);
    }
  });

  it('SERIES removes more than A alone — two lowpasses in a row', () => {
    // A tone above BOTH cutoffs: A attenuates it, then B attenuates what is left.
    const soloA = through(ROUTING_OFF, LP, OPEN, LP, CLOSED, 1, 7040);
    const chained = through(ROUTING_SER, LP, OPEN, LP, CLOSED, 1, 7040);
    expect(chained).toBeLessThan(soloA * 0.5);
  });

  it('PARALLEL passes what either branch passes', () => {
    // A is closed, B is open, the tone sits above A's cutoff and under B's: A
    // alone loses it, and the parallel sum brings it back.
    const soloA = through(ROUTING_OFF, LP, CLOSED, LP, OPEN, 1, 2000);
    const summed = through(ROUTING_PAR, LP, CLOSED, LP, OPEN, 0.5, 2000);
    expect(summed).toBeGreaterThan(soloA * 2);
  });

  it('DIFFERENCE of two lowpasses is a band-pass between their cutoffs', () => {
    // This is why the list allows duplicates: A minus B is a response neither
    // entry can produce alone.
    const band = (hz: number) => through(ROUTING_DIFF, LP, OPEN, LP, CLOSED, 1, hz);
    expect(band(1200)).toBeGreaterThan(band(80) * 5);      // above B's cutoff, under A's
    expect(band(1200)).toBeGreaterThan(band(12000) * 5);
  });

  it('every mode stays bounded with both filters resonant', () => {
    const input = noise(SR * 0.05);
    for (const routing of [ROUTING_SER, ROUTING_PAR, ROUTING_DIFF]) {
      for (let kindA = 0; kindA < 10; kindA++) {
        const s = new FilterStack(kindA, (kindA + 5) % 10, routing, SR);
        let peak = 0;
        for (const x of input) {
          const y = s.update(x * 1.8, 900, 0.95, 300, 0.95, 1);
          expect(Number.isFinite(y), `routing ${routing} kindA ${kindA} went non-finite`).toBe(true);
          const a = Math.abs(y); if (a > peak) peak = a;
        }
        // 9 is generous headroom over the ~4.5 a single driven filter reaches;
        // it is a runaway detector, not a level target.
        expect(peak, `routing ${routing} kindA ${kindA} blew up`).toBeLessThan(9);
      }
    }
  });
});
```

Add `ROUTING_SER, ROUTING_PAR, ROUTING_DIFF` to the existing import from
`./filter-stack` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts`
Expected: FAIL — `combine` returns filter A unchanged, so SERIES removes nothing,
PARALLEL passes nothing extra and DIFFERENCE is not a band. ("blend 0 is filter A
alone" passes already: that is the one thing the seam does get right.)

- [ ] **Step 3: Fill in the three modes**

In `src/audio-dsp/filter-stack.ts`, extend the import back to

```ts
import {
  FILTER_KINDS, ROUTING_OFF, ROUTING_SER, ROUTING_PAR, ROUTING_DIFF, type FilterKind,
} from './filter-kinds';
```

and replace the `combine` body with the three modes:

```ts
  private combine(
    a: number, x: number, b: FilterBlock, cutB: number, resB: number, blend: number,
  ): number {
    switch (this.routing) {
      // A feeds B. Lerped, so blend 0 is A untouched rather than a hard switch.
      case ROUTING_SER: { const chained = b.update(a, cutB, resB); return a + blend * (chained - a); }
      // Both see the same input. At blend 0.5 this is their average; at 1 it is B.
      case ROUTING_PAR: { const parallel = b.update(x, cutB, resB); return a + blend * (parallel - a); }
      // A minus B: what A passes and B does not. Two lowpasses this way are a
      // band-pass between their cutoffs, which no single entry in the list is.
      case ROUTING_DIFF: return a - blend * b.update(x, cutB, resB);
      default: return a;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/audio-dsp/filter-stack.test.ts src/audio-dsp/filter-stack.ts
git commit -F- <<'EOF'
feat(subtractive): series, parallel and difference between the two filters

Blend 0 is filter A alone in every mode, series removes more than A alone,
parallel passes what either branch passes, and the difference of two
lowpasses is a band-pass between their cutoffs -- the response that makes
two identical entries in the list worth having.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Filter B reaches the engine

Declares the six new params, wires them through the renderer (live and
modulatable), and implements TRACK.

**Files:**
- Modify: `src/engines/subtractive-params.ts`
- Modify: `src/engines/subtractive.ts` (`SUB_PARAM_GROUPS`)
- Modify: `src/audio-dsp/types.ts`, `src/audio-dsp/default-params.ts`
- Modify: `src/audio-dsp/subtractive-renderer.ts`
- Test: `src/audio-dsp/subtractive-renderer.test.ts`, `src/engines/subtractive-layout.test.ts`

**Interfaces:**
- Consumes: `FilterStack`, `trackedCutoff`, `FILTER_KIND_OPTIONS`,
  `FILTER_ROUTING_OPTIONS` from Task 1.
- Produces: param ids `filter.routing`, `filter.blend`, `filter2.kind`,
  `filter2.cutoff`, `filter2.resonance`, `filter2.track`; `SubParams` fields
  `filterRouting`, `filterBlend`, `filter2Kind`, `filter2Cutoff`,
  `filter2Resonance`, `filter2Track`.

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/subtractive-renderer.test.ts`:

```ts
describe('the second filter', () => {
  // A patch with the amp env flat and no filter envelope, so what changes is
  // the filtering and nothing else.
  const base: ParamBag = {
    ...DEFAULTS, 'osc1.wave': 0, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 0.55, 'filter.resonance': 0.25, 'filter.envAmount': 0,
    'filter.builtinEnv': 0, 'amp.builtinEnv': 0,
  };
  const render = (over: ParamBag, sec = 0.15): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.4 }), { ...base, ...over }, SR);
    const b: number[] = [];
    for (let i = 0; i < SR * sec; i++) b.push(v.renderSample(i / SR));
    return b;
  };

  it('is off by default — a patch that never mentions it is bit-identical', () => {
    const a = render({});
    const b = render({ 'filter.routing': 0, 'filter2.kind': 3, 'filter2.cutoff': 0.4 });
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });

  it('changes the sound once the routing turns it on', () => {
    const off = render({ 'filter.routing': 0 });
    // Series into a high-pass: the low end goes, so this cannot be a no-op.
    const on = render({ 'filter.routing': 1, 'filter2.kind': 3, 'filter2.cutoff': 0.6, 'filter.blend': 1 });
    expect(rms(on)).toBeLessThan(rms(off) * 0.8);
  });

  it('honours Blend — half of B is between none and all of it', () => {
    const level = (blend: number) =>
      rms(render({ 'filter.routing': 1, 'filter2.kind': 3, 'filter2.cutoff': 0.6, 'filter.blend': blend }));
    expect(level(0.5)).toBeLessThan(level(0));
    expect(level(0.5)).toBeGreaterThan(level(1));
  });

  it('reaches Blend live, so an LFO moves the routing itself', () => {
    const bag: ParamBag = {
      ...base, 'filter.routing': 1, 'filter2.kind': 3, 'filter2.cutoff': 0.6, 'filter.blend': 0.5,
    };
    const sweep = (mod: (t: number) => number): number[] => {
      const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.4 }), bag, SR);
      const { index: ix, mo } = attachSlots(v, bag);
      const off = mo({ 'filter.blend': 0 });
      const b: number[] = [];
      for (let i = 0; i < SR * 0.2; i++) {
        const t = i / SR;
        off[ix.slot['filter.blend']] = mod(t);
        b.push(v.renderSample(t, off));
      }
      return b;
    };
    const still = sweep(() => 0);
    const swept = sweep((t) => Math.sin(2 * Math.PI * 3 * t) * 0.5);
    let diff = 0; for (let i = 0; i < still.length; i++) diff += Math.abs(still[i] - swept[i]);
    expect(diff / still.length).toBeGreaterThan(0.01);
  });

  it('Track 0 leaves B still while A sweeps; Track 1 makes it follow', () => {
    // Parallel at full blend means the output IS filter B, while A's envelope
    // still drives the tracking ratio. So a still B means a still sound, and a
    // following B means a sound that changes across the note.
    const variation = (track: number): number => {
      const b = render({
        'filter.routing': 2, 'filter.blend': 1,
        'filter2.kind': 3, 'filter2.cutoff': 0.35, 'filter2.track': track,
        // A real filter envelope on A: something for B to follow.
        'filter.builtinEnv': 1, 'filter.envAmount': 0.9, 'filter.cutoff': 0.3,
        'filter.attack': 0.001, 'filter.decay': 0.35, 'filter.sustain': 0.05, 'filter.release': 0.2,
      }, 0.3);
      const half = Math.floor(b.length / 2);
      const first = rms(b.slice(0, half)), second = rms(b.slice(half));
      return Math.abs(second - first) / Math.max(1e-9, rms(b));
    };
    expect(variation(1)).toBeGreaterThan(variation(0) * 3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/subtractive-renderer.test.ts`
Expected: FAIL — "changes the sound once the routing turns it on" fails, because
`filter.routing` is not a param the renderer reads yet.

- [ ] **Step 3: Declare the six params**

In `src/engines/subtractive-params.ts`, extend the import:

```ts
import { FILTER_KIND_OPTIONS, FILTER_ROUTING_OPTIONS } from '../audio-dsp/filter-kinds';
```

and add, immediately after the `filter.keyTrack` entry:

```ts
  // Filter B and the routing between the two. Routing OFF is the default and
  // means filter B is never built, so a patch that says nothing about it renders
  // exactly what it always did.
  //
  // Routing and both kinds are discrete AND structural — read once at trigger,
  // for the reason the filter model has always been: a topology is not something
  // you sweep mid-note. Cutoff, Res, Track and Blend are continuous, so they are
  // read every sample and an LFO reaches them like any other knob.
  { id: 'filter.routing',    label: 'Routing', kind: 'discrete', min: 0, max: 3, default: 0,
    options: FILTER_ROUTING_OPTIONS, group: 'filter2' },
  { id: 'filter2.kind',      label: 'Type',    kind: 'discrete', min: 0, max: 9, default: 3,
    options: FILTER_KIND_OPTIONS, group: 'filter2' },
  { id: 'filter2.cutoff',    label: 'Cutoff',  kind: 'continuous', min: 0, max: 1, default: 0.25, group: 'filter2' },
  { id: 'filter2.resonance', label: 'Res',     kind: 'continuous', min: 0, max: 1, default: 0.2, group: 'filter2' },
  // How much of everything that MOVES filter A (its envelope, its key tracking)
  // filter B follows. 0 is a filter nailed where its knob puts it; 1 keeps the
  // interval between the two constant in octaves as both sweep.
  { id: 'filter2.track',     label: 'Track',   kind: 'continuous', min: 0, max: 1, default: 0, group: 'filter2' },
  // How much of filter B is in the result — the same meaning in every routing
  // mode, so 0 is filter A alone whatever the dropdown says.
  { id: 'filter.blend',      label: 'Blend',   kind: 'continuous', min: 0, max: 1, default: 1, group: 'filter2' },
```

- [ ] **Step 4: Declare the FILTER B section**

In `src/engines/subtractive.ts`, replace the `filter` line of
`SUB_PARAM_GROUPS` with two entries:

```ts
  { id: 'filter',  title: 'FILTER A', row: 1, color: 'var(--knob-orange)' },
  { id: 'filter2', title: 'FILTER B', row: 1, color: 'var(--knob-teal)' },
```

- [ ] **Step 5: Extend the flat snapshot**

In `src/audio-dsp/types.ts`, add to `SubParams` right after `filterKind`:

```ts
  filterRouting: number;    // 0 = off, 1 = series, 2 = parallel, 3 = difference
  filterBlend: number;      // 0..1 how much of filter B is in the result
  filter2Kind: number;      // index into FILTER_KINDS
  filter2Cutoff: number; filter2Resonance: number;
  filter2Track: number;     // 0..1 how far B follows A's envelope + key track
```

In `src/audio-dsp/default-params.ts`, after `filterKind: 0,`:

```ts
    filterRouting: 0, filterBlend: 1,
    filter2Kind: 3, filter2Cutoff: 0.25, filter2Resonance: 0.2, filter2Track: 0,
```

- [ ] **Step 6: Wire the renderer**

In `src/audio-dsp/subtractive-renderer.ts`:

Import `trackedCutoff` alongside `FilterStack` (`ROUTING_OFF` is no longer used
here — drop it from the import):

```ts
import { FilterStack, trackedCutoff } from './filter-stack';
```

In `subParamsInto`, after the `filterKind` line:

```ts
  out.filterRouting = param(b, 'filter.routing', 0);
  out.filterBlend = param(b, 'filter.blend', 1);
  out.filter2Kind = param(b, 'filter2.kind', 3);
  out.filter2Cutoff = param(b, 'filter2.cutoff', 0.25);
  out.filter2Resonance = param(b, 'filter2.resonance', 0.2);
  out.filter2Track = param(b, 'filter2.track', 0);
```

Add the four live slots next to the existing ones:

```ts
  private sFilter2Cutoff = -1;
  private sFilter2Resonance = -1;
  private sFilter2Track = -1;
  private sFilterBlend = -1;
```

and resolve them in `setLiveValues`, next to `sFilterKeyTrack`:

```ts
    this.sFilter2Cutoff = slotOf(index, 'filter2.cutoff');
    this.sFilter2Resonance = slotOf(index, 'filter2.resonance');
    this.sFilter2Track = slotOf(index, 'filter2.track');
    this.sFilterBlend = slotOf(index, 'filter.blend');
```

Add a cache pair for filter B's cutoff conversion, next to `cutRaw`/`cutHzCached`:

```ts
  private cut2Raw = NaN;
  private cut2HzCached = 0;
```

In the constructor, build the real stack:

```ts
    this.stack = new FilterStack(p.filterKind, p.filter2Kind, p.filterRouting, sampleRate);
```

In `renderSample`, replace the single-filter call

```ts
    const filtered = this.stack.update(mix, cutoff, q, cutoff, q, 0);
```

with filter B's three live reads and the real call:

```ts
    // Filter B. Its cutoff is its own knob, and Track says how much of A's
    // movement (envelope + key tracking, as one ratio against A's own base) it
    // follows: 0 is a fixed filter under a sweeping one, 1 keeps the interval.
    const cut2Raw01 = mo?.[this.sFilter2Cutoff] ? clamp01((L && this.sFilter2Cutoff >= 0 ? L[this.sFilter2Cutoff] : p.filter2Cutoff) + mo[this.sFilter2Cutoff]) : (L && this.sFilter2Cutoff >= 0 ? L[this.sFilter2Cutoff] : p.filter2Cutoff);
    if (cut2Raw01 !== this.cut2Raw) {
      this.cut2Raw = cut2Raw01;
      this.cut2HzCached = Math.min(60 * Math.pow(220, cut2Raw01), 18000);
    }
    const track = mo?.[this.sFilter2Track] ? clamp01((L && this.sFilter2Track >= 0 ? L[this.sFilter2Track] : p.filter2Track) + mo[this.sFilter2Track]) : (L && this.sFilter2Track >= 0 ? L[this.sFilter2Track] : p.filter2Track);
    const q2 = mo?.[this.sFilter2Resonance] ? clamp01((L && this.sFilter2Resonance >= 0 ? L[this.sFilter2Resonance] : p.filter2Resonance) + mo[this.sFilter2Resonance]) : (L && this.sFilter2Resonance >= 0 ? L[this.sFilter2Resonance] : p.filter2Resonance);
    const blend = mo?.[this.sFilterBlend] ? clamp01((L && this.sFilterBlend >= 0 ? L[this.sFilterBlend] : p.filterBlend) + mo[this.sFilterBlend]) : (L && this.sFilterBlend >= 0 ? L[this.sFilterBlend] : p.filterBlend);
    const cutoff2 = trackedCutoff(this.cut2HzCached, cutoff / Math.max(1e-9, baseCutoffHz), track);
    const filtered = this.stack.update(mix, cutoff, q, cutoff2, q2, blend);
```

- [ ] **Step 7: Run the renderer tests**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/subtractive-renderer.test.ts`
Expected: PASS.

- [ ] **Step 8: Update the layout test**

In `src/engines/subtractive-layout.test.ts`, the FILTER row now holds two
sections. Change the two row assertions:

```ts
  it('gives the two filters a row, and MASTER its own', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OSC 1', 'OSC 2', 'RING', 'SUB', 'NOISE'], ['FILTER A', 'FILTER B'], ['MASTER'], ['POLY'],
    ]);
  });
```

and in the colour test replace the `FILTER` line with:

```ts
    expect(byTitle.get('FILTER A')).toBe('var(--knob-orange)');
    expect(byTitle.get('FILTER B')).toBe('var(--knob-teal)');
```

- [ ] **Step 9: Run the whole unit suite and typecheck**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: typecheck silent, suite green. `declared-params.dsp.test.ts` and
`live-params.dsp.test.ts` are the two that matter most here: the first proves
every id the renderer reads live is declared, the second that the new continuous
params move a sounding note.

- [ ] **Step 10: Check the renderer is still under the cap**

```bash
grep -vcE '^\s*(//|/\*|\*|$)' src/audio-dsp/subtractive-renderer.ts
```

Expected: under 500, and lower than the 321 it started at plus what this task
added — the filter code moved out. If it is over 350, report the number rather
than refactoring on your own initiative.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat(subtractive): a second filter, and a routing control over the two

FILTER B with its own kind, cutoff and resonance, plus Track -- how much of
everything that MOVES filter A (its envelope, its key tracking) B follows,
as a ratio, so the interval between the two stays constant in octaves
rather than collapsing the moment the envelope opens.

Routing is OFF by default and filter B is not even built there, so every
existing patch is bit-identical. Cutoff, Res, Track and Blend are
continuous and read live, so the knobs move the note already sounding and
a modulator reaches them with nothing further to declare.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: The manual, and a look at the real screen

The engine manual currently states something that is already false, and this is
the change that makes it worse if left alone. It also carries the rule that a UI
feature is not done until someone opens it and looks.

**Files:**
- Modify: `docs/manual/04-engines.md`
- Modify: `public/presets/ATTRIBUTION.md` (one stale line)

**Interfaces:**
- Consumes: everything from Tasks 1-4. Produces: nothing code depends on.

- [ ] **Step 1: Replace the filter section of the manual**

In `docs/manual/04-engines.md`, replace the whole `### Filter model and type`
section — including its "only DIG is a true multimode filter ... with Model set
to MOG or 303, the Type dropdown has no effect" warning, which has been false
since the ladders got honest HP and BP taps — with:

```markdown
### The filter list

One dropdown, ten entries, and every one of them works. The label reads
response, then slope, then circuit:

| Entry | What it is |
| --- | --- |
| **LP 12 DIG** | Two-pole state-variable lowpass. Clean and neutral — the default, and what most presets are voiced against. |
| **LP 24 MOG** | Four-pole Moog ladder. Warmer, and it thins as it resonates. |
| **LP 24 303** | Four-pole diode ladder. Asymmetric clipping adds even harmonics — the acid voice. |
| **HP 12 DIG** | The state-variable highpass. |
| **HP 24 MOG** | A real four-pole ladder highpass, derived from the stage taps — not the lowpass relabelled. |
| **HP 24 303** | The same, with the diode ladder's bite. |
| **BP 12 DIG** | Two-pole bandpass. |
| **BP 12 MOG** | The Moog ladder's bandpass tap. |
| **BP 12 303** | The diode ladder's bandpass tap. |
| **NOTCH DIG** | A true notch, and the one response only DIG has. |

Three lowpasses and three highpasses is not redundancy: 12 dB/oct against
24 dB/oct, and state-variable against ladder, are different sounds, and the
label tells you which you are picking.

**Why there is no ladder notch.** A ladder's resonance feedback fills a notch's
null in, and on the diode model at high resonance the null inverts into a *peak*.
A notch that becomes a bump is not a notch, so it is not in the list — rather
than sitting there and quietly handing you the lowpass, which is what the old
Model x Type grid did.

A second thing worth knowing about the ladders: they *lose* level as resonance
climbs, rather than growing a resonant peak on top. Turning Q up on MOG or 303
thins and quietens the sound. That is faithful to the hardware, and it is why
the TB-303 engine compensates with a dedicated accent gain.

### Two filters, and how they are wired

**FILTER B** is a second filter with its own entry from the same list, its own
Cutoff and Res. It is off until **Routing** says otherwise:

| Routing | What comes out |
| --- | --- |
| **Off** (default) | Filter A alone. Filter B is not even built. |
| **Series** | A feeds B — two filters in a row, steeper and darker. |
| **Parallel** | Both filters see the same signal and the results are summed. |
| **Difference** | A minus B. |

**Blend** always means the same thing: how much of B is in the result. At 0 all
three modes sound exactly like Off, so you can bring the second filter in by
hand — or put an LFO on Blend and have the routing itself breathe.

**Difference is the one worth explaining.** Subtracting one lowpass from another
leaves only what sits between their two cutoffs: a band-pass whose two edges you
set separately, with its own resonance on each. That is a response no single
entry in the list can produce, and it is why having three lowpasses to choose
from is useful rather than redundant.

**Track** (0–1) decides how filter B moves. Everything that sweeps filter A —
its envelope and its key tracking — is expressed as a ratio, and Track is how
much of that ratio B follows:

- **0** — B stays exactly where its knob puts it. This is the classic fixed
  high-pass sitting under a low-pass that sweeps.
- **1** — B moves by the same ratio as A, so the interval between the two stays
  constant in octaves. Two formants sweeping as a block.
- In between, B follows part of the way.
```

Then update the parameter-sections list near the top of the Subtractive chapter:
replace the single `- **FILTER**` bullet with

```markdown
- **FILTER A** — the filter list, Cutoff, Resonance, Env Amount, Drive, Key
  Track, and a full ADSR filter envelope (toggle with Built-in Env). See
  [The filter list](#the-filter-list).
- **FILTER B** — Routing, a second filter from the same list, Cutoff, Res,
  Track and Blend. Off by default. See
  [Two filters](#two-filters-and-how-they-are-wired).
```

- [ ] **Step 2: Fix the stale attribution line**

In `public/presets/ATTRIBUTION.md`, the mpump porting table says the ladder
models are "**lossy** — 4-pole saturating ladder -> Loom's 2-pole SVF; drive
stands in for the saturation". Loom has had real ladders since. Replace that
row's mapping with `filter.kind: 1` (MOG) / `filter.kind: 2` (303) and drop the
"lossy" note for those two.

- [ ] **Step 3: Do NOT open a browser**

A UI feature is not done until someone opens it and looks — but that look is the
CONTROLLER's job, not yours, and it happens once at the end over the finished
branch. Starting a dev server from inside a task races the other tasks' writes
(Vite reloads mid-edit) and the ear check is a taste call the user makes.

Leave it. Note in your report that the visual check is pending, and stop.

- [ ] **Step 4: Full suite, one last time**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: typecheck silent, suite green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F- <<'EOF'
docs(manual): the filter list and the two-filter routing

The chapter claimed only DIG was a true multimode and that Type did
nothing on a ladder. That has been false since the ladders got honest HP
and BP taps; it is now replaced by the list itself, entry by entry, plus
why there is no ladder notch and what Difference is for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Sixteen presets that exercise the whole thing

A feature nobody can hear is not shipped. These sixteen cover **all ten entries
in the list, all four routing modes and both ends of Track**, and six of them
carry a modulator so the moving parts move. Three go further and cover what the
engine already had but no preset ever demonstrated: the **ring modulator** (new
on this branch, and with no preset at all today) and **PWM** — `ATTRIBUTION.md`
literally tells the reader to "put an LFO on `osc1.pw`" to hear it, and until now
not one preset did.

| Preset | Filter A | Routing | Filter B | Track | Modulator |
|---|---|---|---|---|---|
| `PAD Glass Air` | 4 `HP 24 MOG` | Off | — | — | — |
| `PAD Hollow Band` | 0 `LP 12 DIG` | Series | 3 `HP 12 DIG` | 0 | — |
| `LEAD Notch Vox` | 9 `NOTCH DIG` | Off | — | — | LFO -> `filter.cutoff` |
| `BASS Twin Growl` | 2 `LP 24 303` | Difference | 1 `LP 24 MOG` | 0.5 | LFO -> `filter.blend` |
| `KEY Morph Two Ways` | 5 `HP 24 303` | Parallel | 6 `BP 12 DIG` | 0.6 | ADSR -> `filter.blend` |
| `LEAD BP Sweep` | 7 `BP 12 MOG` | Parallel | 8 `BP 12 303` | 1 | LFO -> `filter.cutoff` |
| `BASS Acid Diode` | 2 `LP 24 303` | Off | — | — | — |
| `PLUCK Thin Air` | 3 `HP 12 DIG` | Off | — | — | — |
| `LEAD Formant Two` | 6 `BP 12 DIG` | Parallel | 7 `BP 12 MOG` | 0 | — |
| `BASS Hollow Sub` | 9 `NOTCH DIG` | Series | 0 `LP 12 DIG` | 0.3 | — |
| `PAD Phase Ghost` | 0 `LP 12 DIG` | Difference | 0 `LP 12 DIG` | 0 | LFO -> `filter2.cutoff` |
| `LEAD Moog Cream` | 1 `LP 24 MOG` | Off | — | — | — |
| `FX Metal Comb` | 8 `BP 12 303` | Difference | 6 `BP 12 DIG` | 0 | — (Ring 0.8) |
| `PAD Wide Split` | 3 `HP 12 DIG` | Parallel | 1 `LP 24 MOG` | 1 | — |
| `KEY Bell Ring` | 6 `BP 12 DIG` | Off | — | — | ADSR -> `ring.level` |
| `PAD PWM Breather` | 0 `LP 12 DIG` | Off | — | — | LFO -> `osc1.pw` |

`PAD Phase Ghost` is the one to notice: **both filters are the same entry**,
`LP 12 DIG`, at different cutoffs, subtracted. It is the answer to "why would I
want two identical lowpasses in the list" — the difference between them is a
moving band, and no single entry can make it.

**Files:**
- Modify: `public/presets/subtractive.json`
- Test: `src/presets/subtractive-filter-presets.test.ts`

**Interfaces:**
- Consumes: every param id from Tasks 2 and 4.
- Produces: six preset names, asserted by the test below.

- [ ] **Step 1: Write the failing test**

Create `src/presets/subtractive-filter-presets.test.ts`:

```ts
// src/presets/subtractive-filter-presets.test.ts
//
// The six presets that exercise the filter stack. A feature nobody can hear is
// not shipped, and "the presets cover it" is a claim worth asserting rather
// than believing: between them these six must touch every entry in the list and
// every routing mode, and the three that carry a modulator must actually move.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUB_PARAM_SPECS } from '../engines/subtractive-params';
import { FILTER_KINDS } from '../audio-dsp/filter-kinds';
import { SubtractiveVoiceRenderer } from '../audio-dsp/subtractive-renderer';
import { buildParamIndex } from '../audio-dsp/param-index';
import type { ParamBag } from '../audio-dsp/types';

interface Mod {
  id: string; kind: string; enabled: boolean;
  connections: { id: string; paramId: string; depth: number }[];
}
interface Preset { name: string; params: Record<string, number>; modulators?: Mod[] }
const PRESETS: Preset[] = JSON.parse(
  readFileSync(resolve('public/presets/subtractive.json'), 'utf8'),
).presets;

const STACK_PRESETS = [
  'PAD Glass Air', 'PAD Hollow Band', 'LEAD Notch Vox',
  'BASS Twin Growl', 'KEY Morph Two Ways', 'LEAD BP Sweep',
  'BASS Acid Diode', 'PLUCK Thin Air', 'LEAD Formant Two', 'BASS Hollow Sub',
  'PAD Phase Ghost', 'LEAD Moog Cream', 'FX Metal Comb', 'PAD Wide Split',
  'KEY Bell Ring', 'PAD PWM Breather',
];
const byName = (name: string): Preset => {
  const p = PRESETS.find((x) => x.name === name);
  if (!p) throw new Error(`preset "${name}" is missing`);
  return p;
};

const SR = 48000;
const MIDI = 48;
const DEFAULT_BAG: ParamBag = Object.fromEntries(SUB_PARAM_SPECS.map((s) => [s.id, s.default]));
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

/** Render a preset, optionally driving one modulation target by hand — the
 *  preset's own modulators are state, not a running LFO, so a test that wants
 *  to prove the movement has to supply it. */
function render(preset: Preset, seconds: number, drive?: { paramId: string; at: (t: number) => number }): number[] {
  const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
  const v = new SubtractiveVoiceRenderer(
    { midi: MIDI, beginSec: 0, durationSec: seconds * 0.6, velocity: 0.8, accent: false, slide: false },
    bag, SR,
  );
  const index = buildParamIndex([...Object.keys(bag), 'output.trim']);
  const live = new Float64Array(index.length);
  for (const id in bag) live[index.slot[id]] = bag[id];
  v.setLiveValues?.(live, index);
  const mo = new Float64Array(index.length);
  const slot = drive ? index.slot[drive.paramId] : -1;
  const out: number[] = [];
  for (let i = 0; i < SR * seconds; i++) {
    const t = i / SR;
    if (drive && slot >= 0) mo[slot] = drive.at(t);
    out.push(v.renderSample(t, drive ? mo : undefined));
  }
  return out;
}

describe('the filter-stack presets exist and are audible', () => {
  it.each(STACK_PRESETS)('%s is in the pack', (name) => {
    expect(PRESETS.some((p) => p.name === name)).toBe(true);
  });

  it.each(STACK_PRESETS)('%s makes a sound', (name) => {
    // Same floor the rest of the pack is held to (subtractive-presets.test.ts):
    // measured against silence, not against another preset.
    expect(rms(render(byName(name), 0.5))).toBeGreaterThan(0.01);
  });
});

describe('between them the presets exercise the whole filter stack', () => {
  const kindsUsed = (): Set<number> => {
    const s = new Set<number>();
    for (const name of STACK_PRESETS) {
      const p = byName(name).params;
      s.add(p['filter.kind'] ?? 0);
      if ((p['filter.routing'] ?? 0) !== 0) s.add(p['filter2.kind'] ?? 3);
    }
    return s;
  };

  it('covers every entry in the list', () => {
    const used = kindsUsed();
    const missing = FILTER_KINDS.map((k, i) => [k.label, i] as const).filter(([, i]) => !used.has(i));
    expect(missing.map(([label]) => label), 'no preset demonstrates these').toEqual([]);
  });

  it('covers every routing mode', () => {
    const used = new Set(STACK_PRESETS.map((n) => byName(n).params['filter.routing'] ?? 0));
    expect([...used].sort()).toEqual([0, 1, 2, 3]);
  });

  it('demonstrates both ends of Track', () => {
    const tracks = STACK_PRESETS.map((n) => byName(n).params['filter2.track']).filter((v) => v !== undefined);
    expect(Math.min(...tracks as number[])).toBe(0);
    expect(Math.max(...tracks as number[])).toBe(1);
  });

  const connectedTo = (name: string, paramId: string, kind: string): boolean =>
    (byName(name).modulators ?? []).some(
      (m) => m.kind === kind && m.enabled && m.connections.some((c) => c.paramId === paramId && c.depth !== 0),
    );

  it('ships a modulator on Blend, from an LFO and from an ADSR', () => {
    expect(connectedTo('BASS Twin Growl', 'filter.blend', 'lfo'), 'LFO on Blend').toBe(true);
    expect(connectedTo('KEY Morph Two Ways', 'filter.blend', 'adsr'), 'ADSR on Blend').toBe(true);
  });

  it('demonstrates the duplicate case the list exists to allow', () => {
    // Both filters the SAME entry, at different cutoffs, subtracted. If nobody
    // ships this patch, "why would I want two identical lowpasses" has no answer
    // in the pack.
    const p = byName('PAD Phase Ghost').params;
    expect(p['filter.kind']).toBe(p['filter2.kind']);
    expect(p['filter.routing']).toBe(3);
    expect(p['filter.cutoff']).not.toBe(p['filter2.cutoff']);
    expect(connectedTo('PAD Phase Ghost', 'filter2.cutoff', 'lfo'), 'LFO on B cutoff').toBe(true);
  });

  it('demonstrates the ring modulator, which had no preset at all', () => {
    expect(byName('FX Metal Comb').params['ring.level']).toBeGreaterThan(0.5);
    expect(connectedTo('KEY Bell Ring', 'ring.level', 'adsr'), 'ADSR on Ring').toBe(true);
  });

  it('demonstrates PWM — an LFO on the width, which is what makes it PWM', () => {
    // ATTRIBUTION.md tells the reader to put an LFO on osc1.pw to hear the real
    // thing, and until this pack not one preset did.
    expect(byName('PAD PWM Breather').params['osc1.wave'], 'width only bites on a square').toBe(1);
    expect(connectedTo('PAD PWM Breather', 'osc1.pw', 'lfo'), 'LFO on the width').toBe(true);
  });
});

describe('the modulated presets actually move', () => {
  it('BASS Twin Growl changes as its Blend LFO sweeps', () => {
    const still = render(byName('BASS Twin Growl'), 0.4);
    const swept = render(byName('BASS Twin Growl'), 0.4, {
      paramId: 'filter.blend', at: (t) => Math.sin(2 * Math.PI * 2 * t) * 0.4,
    });
    let diff = 0; for (let i = 0; i < still.length; i++) diff += Math.abs(still[i] - swept[i]);
    expect(diff / still.length).toBeGreaterThan(0.01);
  });

  it('KEY Morph Two Ways morphs from filter A to filter B as Blend rises', () => {
    // Blend at 0 is filter A alone; at 1 the parallel path is filter B alone.
    // The two are a 4-pole highpass and a clean bandpass — if the morph were a
    // no-op these would be the same sound.
    const at = (blend: number) => render(
      { ...byName('KEY Morph Two Ways'), params: { ...byName('KEY Morph Two Ways').params, 'filter.blend': blend } },
      0.3,
    );
    const a = at(0), b = at(1);
    let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff / a.length / Math.max(1e-9, rms(a))).toBeGreaterThan(0.1);
  });

  it('LEAD BP Sweep keeps both bandpasses moving together at Track 1', () => {
    expect(byName('LEAD BP Sweep').params['filter2.track']).toBe(1);
    expect(byName('LEAD BP Sweep').params['filter.envAmount']).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/presets/subtractive-filter-presets.test.ts`
Expected: FAIL — `preset "PAD Glass Air" is missing`.

- [ ] **Step 3: Add the six presets**

Append these to the `presets` array in `public/presets/subtractive.json`:

```json
    {
      "name": "PAD Glass Air",
      "gm": [89, 92],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.7, "osc1.detune": -6,
        "osc2.wave": 0, "osc2.level": 0.6, "osc2.detune": 8,
        "sub.level": 0.3, "noise.level": 0.06, "noise.color": 0.85,
        "master.unison": 5, "master.detune": 16, "master.drift": 0.3,
        "filter.kind": 4, "filter.cutoff": 0.28, "filter.resonance": 0.3,
        "filter.envAmount": 0.2, "filter.drive": 0.05,
        "filter.attack": 0.4, "filter.decay": 1.0, "filter.sustain": 0.6, "filter.release": 1.2,
        "amp.attack": 0.25, "amp.decay": 1.2, "amp.sustain": 0.8, "amp.release": 1.2,
        "output.trim": 1.5
      }
    },
    {
      "name": "PAD Hollow Band",
      "gm": [90, 95],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.7, "osc1.detune": -5,
        "osc2.wave": 1, "osc2.level": 0.45, "osc2.detune": 7, "osc2.pw": 0.35,
        "sub.level": 0.3, "noise.level": 0,
        "master.unison": 3, "master.detune": 14, "master.drift": 0.2,
        "filter.kind": 0, "filter.cutoff": 0.55, "filter.resonance": 0.3,
        "filter.envAmount": 0.5, "filter.drive": 0.05,
        "filter.attack": 0.3, "filter.decay": 1.1, "filter.sustain": 0.45, "filter.release": 1.0,
        "filter.routing": 1, "filter2.kind": 3, "filter2.cutoff": 0.3,
        "filter2.resonance": 0.25, "filter2.track": 0, "filter.blend": 1,
        "amp.attack": 0.2, "amp.decay": 1.0, "amp.sustain": 0.8, "amp.release": 1.1
      }
    },
    {
      "name": "LEAD Notch Vox",
      "gm": [85, 86],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.9, "osc1.detune": -4,
        "osc2.wave": 1, "osc2.level": 0.5, "osc2.detune": 12, "osc2.pw": 0.4,
        "sub.level": 0.2, "noise.level": 0,
        "master.unison": 2, "master.detune": 12,
        "filter.kind": 9, "filter.cutoff": 0.5, "filter.resonance": 0.6,
        "filter.envAmount": 0.3, "filter.drive": 0.15,
        "filter.attack": 0.01, "filter.decay": 0.4, "filter.sustain": 0.5, "filter.release": 0.3,
        "amp.attack": 0.01, "amp.decay": 0.3, "amp.sustain": 0.8, "amp.release": 0.25
      },
      "modulators": [
        {
          "id": "lfo1", "kind": "lfo", "enabled": true, "bipolar": true,
          "waveform": "sine", "syncToBpm": true, "syncBars": 1, "syncSubdiv": "straight",
          "trigger": "free", "scope": "shared",
          "connections": [{ "id": "c1", "paramId": "filter.cutoff", "depth": 0.35 }]
        }
      ]
    },
    {
      "name": "BASS Twin Growl",
      "gm": [38, 39],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.9, "osc1.detune": 0,
        "osc2.wave": 1, "osc2.level": 0.35, "osc2.detune": -7,
        "sub.level": 0.45, "noise.level": 0,
        "filter.kind": 2, "filter.cutoff": 0.62, "filter.resonance": 0.7,
        "filter.envAmount": 0.25, "filter.drive": 0.25,
        "filter.attack": 0.005, "filter.decay": 0.25, "filter.sustain": 0.4, "filter.release": 0.15,
        "filter.routing": 3, "filter2.kind": 1, "filter2.cutoff": 0.3,
        "filter2.resonance": 0.45, "filter2.track": 0.5, "filter.blend": 0.55,
        "amp.attack": 0.005, "amp.decay": 0.2, "amp.sustain": 0.75, "amp.release": 0.1
      },
      "modulators": [
        {
          "id": "lfo1", "kind": "lfo", "enabled": true, "bipolar": true,
          "waveform": "sine", "syncToBpm": true, "syncBars": 2, "syncSubdiv": "straight",
          "trigger": "free", "scope": "shared",
          "connections": [{ "id": "c1", "paramId": "filter.blend", "depth": 0.4 }]
        }
      ]
    },
    {
      "name": "KEY Morph Two Ways",
      "gm": [4, 5],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.8, "osc1.detune": -4,
        "osc2.wave": 2, "osc2.level": 0.5, "osc2.detune": 6,
        "sub.level": 0.25, "noise.level": 0.03, "noise.color": 0.7,
        "master.unison": 3, "master.detune": 12, "master.drift": 0.15,
        "filter.kind": 5, "filter.cutoff": 0.35, "filter.resonance": 0.4,
        "filter.envAmount": 0.3, "filter.drive": 0.1,
        "filter.attack": 0.02, "filter.decay": 0.8, "filter.sustain": 0.5, "filter.release": 0.6,
        "filter.routing": 2, "filter2.kind": 6, "filter2.cutoff": 0.55,
        "filter2.resonance": 0.55, "filter2.track": 0.6, "filter.blend": 0,
        "amp.attack": 0.05, "amp.decay": 0.9, "amp.sustain": 0.7, "amp.release": 0.7,
        "output.trim": 1.3
      },
      "modulators": [
        {
          "id": "adsr-blend", "kind": "adsr", "enabled": true, "scope": "per-voice",
          "attackSec": 0.6, "decaySec": 1.2, "sustain": 0.35, "releaseSec": 0.8,
          "connections": [{ "id": "c1", "paramId": "filter.blend", "depth": 1 }]
        }
      ]
    },
    {
      "name": "LEAD BP Sweep",
      "gm": [81, 82],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.9, "osc1.detune": -6,
        "osc2.wave": 0, "osc2.level": 0.7, "osc2.detune": 9,
        "sub.level": 0.2, "noise.level": 0,
        "master.unison": 3, "master.detune": 18,
        "filter.kind": 7, "filter.cutoff": 0.35, "filter.resonance": 0.6,
        "filter.envAmount": 0.85, "filter.drive": 0.15,
        "filter.attack": 0.01, "filter.decay": 0.6, "filter.sustain": 0.25, "filter.release": 0.4,
        "filter.routing": 2, "filter2.kind": 8, "filter2.cutoff": 0.5,
        "filter2.resonance": 0.55, "filter2.track": 1, "filter.blend": 0.5,
        "amp.attack": 0.01, "amp.decay": 0.5, "amp.sustain": 0.7, "amp.release": 0.3,
        "output.trim": 1.4
      },
      "modulators": [
        {
          "id": "lfo1", "kind": "lfo", "enabled": true, "bipolar": true,
          "waveform": "triangle", "syncToBpm": true, "syncBars": 0.5, "syncSubdiv": "straight",
          "trigger": "free", "scope": "shared",
          "connections": [{ "id": "c1", "paramId": "filter.cutoff", "depth": 0.25 }]
        }
      ]
    },
    {
      "name": "BASS Acid Diode",
      "gm": [38, 87],
      "params": {
        "osc1.wave": 0, "osc1.level": 1, "osc1.detune": 0,
        "osc2.wave": 1, "osc2.level": 0.25, "osc2.detune": -12,
        "sub.level": 0.35, "noise.level": 0,
        "filter.kind": 2, "filter.cutoff": 0.42, "filter.resonance": 0.8,
        "filter.envAmount": 0.7, "filter.drive": 0.35,
        "filter.attack": 0.002, "filter.decay": 0.18, "filter.sustain": 0.15, "filter.release": 0.12,
        "amp.attack": 0.003, "amp.decay": 0.25, "amp.sustain": 0.7, "amp.release": 0.1
      }
    },
    {
      "name": "PLUCK Thin Air",
      "gm": [45, 46],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.85, "osc1.detune": -3,
        "osc2.wave": 2, "osc2.level": 0.4, "osc2.detune": 5,
        "sub.level": 0, "noise.level": 0.08, "noise.color": 0.9,
        "filter.kind": 3, "filter.cutoff": 0.4, "filter.resonance": 0.5,
        "filter.envAmount": 0.4, "filter.drive": 0.05,
        "filter.attack": 0.002, "filter.decay": 0.22, "filter.sustain": 0.1, "filter.release": 0.2,
        "amp.attack": 0.002, "amp.decay": 0.28, "amp.sustain": 0.05, "amp.release": 0.22,
        "output.trim": 1.3
      }
    },
    {
      "name": "LEAD Formant Two",
      "gm": [85, 54],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.9, "osc1.detune": -5,
        "osc2.wave": 0, "osc2.level": 0.6, "osc2.detune": 10,
        "sub.level": 0.15, "noise.level": 0,
        "master.unison": 2, "master.detune": 12,
        "filter.kind": 6, "filter.cutoff": 0.42, "filter.resonance": 0.7,
        "filter.envAmount": 0.15, "filter.drive": 0.1,
        "filter.attack": 0.01, "filter.decay": 0.4, "filter.sustain": 0.6, "filter.release": 0.3,
        "filter.routing": 2, "filter2.kind": 7, "filter2.cutoff": 0.62,
        "filter2.resonance": 0.7, "filter2.track": 0, "filter.blend": 0.5,
        "amp.attack": 0.01, "amp.decay": 0.4, "amp.sustain": 0.8, "amp.release": 0.25,
        "output.trim": 1.3
      }
    },
    {
      "name": "BASS Hollow Sub",
      "gm": [38, 33],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.8, "osc1.detune": 0,
        "osc2.wave": 1, "osc2.level": 0.3, "osc2.detune": -7,
        "sub.level": 0.5, "noise.level": 0,
        "filter.kind": 9, "filter.cutoff": 0.45, "filter.resonance": 0.5,
        "filter.envAmount": 0.3, "filter.drive": 0.15,
        "filter.attack": 0.004, "filter.decay": 0.3, "filter.sustain": 0.4, "filter.release": 0.15,
        "filter.routing": 1, "filter2.kind": 0, "filter2.cutoff": 0.5,
        "filter2.resonance": 0.3, "filter2.track": 0.3, "filter.blend": 1,
        "amp.attack": 0.004, "amp.decay": 0.3, "amp.sustain": 0.75, "amp.release": 0.12
      }
    },
    {
      "name": "PAD Phase Ghost",
      "gm": [95, 89],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.75, "osc1.detune": -7,
        "osc2.wave": 0, "osc2.level": 0.65, "osc2.detune": 9,
        "sub.level": 0.25, "noise.level": 0,
        "master.unison": 5, "master.detune": 15, "master.drift": 0.25,
        "filter.kind": 0, "filter.cutoff": 0.75, "filter.resonance": 0.35,
        "filter.envAmount": 0.15, "filter.drive": 0.05,
        "filter.attack": 0.3, "filter.decay": 1.0, "filter.sustain": 0.7, "filter.release": 1.0,
        "filter.routing": 3, "filter2.kind": 0, "filter2.cutoff": 0.35,
        "filter2.resonance": 0.35, "filter2.track": 0, "filter.blend": 0.9,
        "amp.attack": 0.25, "amp.decay": 1.1, "amp.sustain": 0.8, "amp.release": 1.2
      },
      "modulators": [
        {
          "id": "lfo1", "kind": "lfo", "enabled": true, "bipolar": true,
          "waveform": "triangle", "syncToBpm": true, "syncBars": 4, "syncSubdiv": "straight",
          "trigger": "free", "scope": "shared",
          "connections": [{ "id": "c1", "paramId": "filter2.cutoff", "depth": 0.25 }]
        }
      ]
    },
    {
      "name": "LEAD Moog Cream",
      "gm": [81, 80],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.9, "osc1.detune": -4,
        "osc2.wave": 0, "osc2.level": 0.6, "osc2.detune": 7,
        "sub.level": 0.3, "noise.level": 0,
        "master.unison": 3, "master.detune": 15,
        "filter.kind": 1, "filter.cutoff": 0.5, "filter.resonance": 0.7,
        "filter.envAmount": 0.5, "filter.drive": 0.2,
        "filter.attack": 0.01, "filter.decay": 0.45, "filter.sustain": 0.45, "filter.release": 0.3,
        "amp.attack": 0.01, "amp.decay": 0.4, "amp.sustain": 0.8, "amp.release": 0.25
      }
    },
    {
      "name": "FX Metal Comb",
      "gm": [98, 121],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.5, "osc1.detune": 0,
        "osc2.wave": 1, "osc2.level": 0.5, "osc2.detune": 40,
        "ring.level": 0.8,
        "sub.level": 0, "noise.level": 0.05, "noise.color": 0.75,
        "filter.kind": 8, "filter.cutoff": 0.55, "filter.resonance": 0.6,
        "filter.envAmount": 0.35, "filter.drive": 0.15,
        "filter.attack": 0.01, "filter.decay": 0.5, "filter.sustain": 0.4, "filter.release": 0.5,
        "filter.routing": 3, "filter2.kind": 6, "filter2.cutoff": 0.3,
        "filter2.resonance": 0.5, "filter2.track": 0, "filter.blend": 0.7,
        "amp.attack": 0.005, "amp.decay": 0.7, "amp.sustain": 0.5, "amp.release": 0.6,
        "output.trim": 1.3
      }
    },
    {
      "name": "PAD Wide Split",
      "gm": [91, 89],
      "params": {
        "osc1.wave": 0, "osc1.level": 0.7, "osc1.detune": -8,
        "osc2.wave": 0, "osc2.level": 0.65, "osc2.detune": 10,
        "sub.level": 0.3, "noise.level": 0.04, "noise.color": 0.8,
        "master.unison": 5, "master.detune": 18, "master.drift": 0.3,
        "filter.kind": 3, "filter.cutoff": 0.3, "filter.resonance": 0.3,
        "filter.envAmount": 0.3, "filter.drive": 0.05,
        "filter.attack": 0.35, "filter.decay": 1.2, "filter.sustain": 0.6, "filter.release": 1.2,
        "filter.routing": 2, "filter2.kind": 1, "filter2.cutoff": 0.45,
        "filter2.resonance": 0.4, "filter2.track": 1, "filter.blend": 0.5,
        "amp.attack": 0.25, "amp.decay": 1.2, "amp.sustain": 0.8, "amp.release": 1.3
      }
    },
    {
      "name": "KEY Bell Ring",
      "gm": [14, 9],
      "params": {
        "osc1.wave": 3, "osc1.level": 0.75, "osc1.detune": 0,
        "osc2.wave": 3, "osc2.level": 0.3, "osc2.detune": 35,
        "ring.level": 0.6,
        "sub.level": 0, "noise.level": 0,
        "filter.kind": 6, "filter.cutoff": 0.6, "filter.resonance": 0.4,
        "filter.envAmount": 0.25, "filter.drive": 0.05,
        "filter.attack": 0.002, "filter.decay": 0.8, "filter.sustain": 0.3, "filter.release": 0.8,
        "amp.attack": 0.002, "amp.decay": 1.2, "amp.sustain": 0.25, "amp.release": 1.0,
        "output.trim": 1.4
      },
      "modulators": [
        {
          "id": "adsr-ring", "kind": "adsr", "enabled": true, "scope": "per-voice",
          "attackSec": 0.002, "decaySec": 0.5, "sustain": 0, "releaseSec": 0.4,
          "connections": [{ "id": "c1", "paramId": "ring.level", "depth": 0.4 }]
        }
      ]
    },
    {
      "name": "PAD PWM Breather",
      "gm": [90, 89],
      "params": {
        "osc1.wave": 1, "osc1.level": 0.9, "osc1.detune": -5, "osc1.pw": 0.5,
        "osc2.wave": 1, "osc2.level": 0.5, "osc2.detune": 7, "osc2.pw": 0.45,
        "sub.level": 0.25, "noise.level": 0,
        "master.unison": 3, "master.detune": 14, "master.drift": 0.2,
        "filter.kind": 0, "filter.cutoff": 0.5, "filter.resonance": 0.3,
        "filter.envAmount": 0.35, "filter.drive": 0.05,
        "filter.attack": 0.3, "filter.decay": 1.0, "filter.sustain": 0.6, "filter.release": 1.0,
        "amp.attack": 0.2, "amp.decay": 1.0, "amp.sustain": 0.8, "amp.release": 1.0
      },
      "modulators": [
        {
          "id": "lfo1", "kind": "lfo", "enabled": true, "bipolar": true,
          "waveform": "sine", "syncToBpm": true, "syncBars": 4, "syncSubdiv": "straight",
          "trigger": "free", "scope": "shared",
          "connections": [{ "id": "c1", "paramId": "osc1.pw", "depth": 0.6 }]
        }
      ]
    }
```

- [ ] **Step 4: Run the preset tests**

Run: `NO_COLOR=1 npx vitest run src/presets/`
Expected: PASS, including the existing `subtractive-presets.test.ts` schema,
range, integer, audibility and boundedness checks — now over 101 presets.

Two failures are plausible and each has one honest fix:

- **`rms` under 0.01** on a highpass preset (`PAD Glass Air`, `PLUCK Thin Air`,
  `KEY Morph Two Ways`, `PAD Wide Split`): a highpass throws the fundamental
  away, so these are quiet by construction. RAISE that preset's `output.trim`
  (the per-preset gain-staging lever, capped at 4 by the schema test) until it
  clears the floor. Do NOT lower the floor.
- **`peak` over 4.0** on a DIFFERENCE preset (`BASS Twin Growl`,
  `PAD Phase Ghost`, `FX Metal Comb`): subtracting two resonant filters lets
  their peaks add. LOWER `filter.resonance` / `filter2.resonance` in 0.05 steps,
  or add `"output.trim": 0.8`. Do NOT raise `BLOW_UP`.

Report every preset you retuned and to what.

- [ ] **Step 5: Full suite and typecheck**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: typecheck silent, suite green.

- [ ] **Step 6: Do NOT listen to them yourself — write down what to listen FOR**

The presets are judged by ear, and the ear belongs to the user. Do not start a
dev server. Instead, copy the list below into your report verbatim, so the
controller's listening pass has the acceptance criteria in front of it.

What each one must sound like:

- `PAD Glass Air` — airy and thin, no boom. A pad with its bottom removed, not a
  quiet pad.
- `PAD Hollow Band` — the low-pass sweeps and the high-pass does NOT: the body
  moves while the bottom edge stays put. That is Track 0.
- `LEAD Notch Vox` — a moving hole in the middle, vowel-ish. If it sounds like a
  plain low-pass sweep, the notch is not reaching the engine.
- `BASS Twin Growl` — the growl comes from the BAND opening and closing, not
  from a cutoff wobble. Wider and hollower than a normal wobble bass.
- `KEY Morph Two Ways` — starts thin and highpassed, arrives somewhere nasal and
  bandpassed as the note holds. The ADSR is doing that.
- `LEAD BP Sweep` — two bandpasses sweeping together, keeping their interval.
- `BASS Acid Diode` — squelch, with the diode ladder's bite. It should sound like
  the 303 engine's cousin, not like a clean bass.
- `PLUCK Thin Air` — a short, bodyless pluck. All attack, no fundamental.
- `LEAD Formant Two` — two fixed peaks: nasal, vowel-like, and it does NOT move.
- `BASS Hollow Sub` — a sub with a hole punched in its middle, then rounded off.
- `PAD Phase Ghost` — a slow phaser-like sweep with no phaser in the chain. The
  moving band between two identical lowpasses IS the effect.
- `LEAD Moog Cream` — creamy, and it THINS as the resonance bites. That thinning
  is the ladder being faithful, not a bug.
- `FX Metal Comb` — inharmonic and metallic, the ring modulator through a band.
- `PAD Wide Split` — wide, with a scooped middle: a highpass and a lowpass side
  by side, sweeping together.
- `KEY Bell Ring` — a metallic strike that decays into a clean tone. The ADSR on
  Ring is what makes the strike metallic and the tail clean.
- `PAD PWM Breather` — the width breathes. If it sits still, the LFO is not
  reaching `osc1.pw` and the preset is a plain square pad.

Report anything that sounds wrong rather than silently retuning it — these are
taste calls and the user is the one who makes them.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat(presets): sixteen subtractive presets that exercise the whole engine

Between them they touch all ten entries in the filter list, all four
routing modes and both ends of Track, and the test asserts that coverage
rather than trusting it: an entry nobody demonstrates fails the suite.

The ones that carry the argument: PAD Phase Ghost puts the SAME lowpass in
both slots at different cutoffs and subtracts them, which is the answer to
"why would I want two identical entries" -- the moving band between them is
a phaser with no phaser in the chain. BASS Twin Growl growls by opening
and closing that band with an LFO on Blend rather than on a cutoff. KEY
Morph Two Ways walks from a four-pole highpass to a clean bandpass across
the note with an ADSR on Blend. PAD Hollow Band is the fixed highpass under
a sweeping lowpass that Track 0 exists for; LEAD BP Sweep is the same pair
moving as a block at Track 1.

Three of them cover what the engine already had and no preset ever
demonstrated: FX Metal Comb and KEY Bell Ring are the first presets to use
the ring modulator at all, and PAD PWM Breather is the first to put an LFO
on osc1.pw -- which ATTRIBUTION.md has been telling readers to do by hand
since the pulse width was exposed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## After the last task

Report to the user:

- The suite result (file count and test count), and the screenshot from Task 5.
- The renderer's code-line count before and after.
- That the branch is `worktree-subtractive-ringmod`, holding BOTH the ring
  modulator and this work, and that **nothing has been merged** — the merge is
  the user's call.

Do NOT merge to `main`, do NOT switch branch or worktree, and do NOT call
`ExitWorktree` while the user is still reviewing.
