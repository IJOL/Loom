# Subtractive Filter Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Subtractive engine a Mode x Type filter choice where no button can lie, a fourth circuit (COMB) with three responses of its own, a second filter block, and a routing control over the two.

**Architecture:** `src/audio-dsp/filter-kinds.ts` holds the data — a table of circuits, each declaring the taps it can honestly produce — and `src/audio-dsp/filter-stack.ts` holds the DSP: one `FilterBlock` per slot, plus the routing between them. The UI's Type control builds its option list from the chosen Mode's taps, so an impossible pair is not merely unreachable, it cannot be represented: `type` indexes the mode's own tap list and is clamped.

**Tech Stack:** TypeScript, Vitest, no new dependencies.

## Where this starts

Two commits are already on the branch:

- `cb4c1df` — the ring modulator (`ring.level`), finished and independent.
- `7cfb100` — this work so far: the spec (final shape), this plan's predecessor, and code in a **superseded** shape. `filter-kinds.ts` + `filter-stack.ts` exist with a FLAT ten-entry `FILTER_KINDS` list and one `filter.kind` param; `subtractive-renderer.ts` is already off its own filter code and onto `FilterStack`; `ladderTapFor` and its NOTCH-on-a-ladder lie are already deleted.

Task 1 below reshapes that table and those params into Mode x Type. Everything else in those two files — `FilterBlock`, `FilterStack`, `trackedCutoff`, the no-silent-alias test — survives.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-02-subtractive-filter-stack-design.md`. Read it before Task 1.
- **Branch:** stay on `worktree-subtractive-ringmod`, in the worktree at `.claude/worktrees/subtractive-ringmod`. Do NOT change branch, do NOT create a worktree, do NOT merge to `main`.
- **Language:** all code, comments, labels and commit messages in **English**.
- **No lying buttons.** This is the acceptance criterion the whole round exists for: a control must never paint an option that does not do what it says. When in doubt, do not paint it.
- **TDD:** failing test first, run it, see it fail for the stated reason, then implement.
- **Assertions are relative** (ratios, ordering), never absolute magnitudes unless justified in a comment.
- **One test per user path.** No `(or ...)` alternatives inside a test.
- Run single test files as `NO_COLOR=1 npx vitest run <path>`. Never add `--reporter=`.
- Commit with a heredoc (`git commit -F- <<'EOF'`), never a PowerShell here-string.
- Do NOT run `npm run test:e2e` — it serves a stale `dist/` with no build step.
- `npm run test:unit` sometimes exits non-zero with `ERR_IPC_CHANNEL_CLOSED` AFTER every test passes. Known flaky teardown; re-run once to confirm.
- **File size:** target 300 code lines, hard cap 500 (comments and blanks do not count).
- **Every UI write of an engine param goes through `commitParam`** (`engine-param-commit.ts`) — never `setBaseValue` alone, or the edit is thrown away on save.

---

### Task 1: Mode x Type, with Type filtered by Mode

Reshapes the flat list into a table of circuits-with-taps, brings back `filter.model` / `filter.type`, and teaches the param grid to build one control's options from another param's value.

**Files:**
- Modify: `src/audio-dsp/filter-kinds.ts` (the table)
- Modify: `src/audio-dsp/filter-stack.ts` (`FilterBlock` takes a model + tap)
- Modify: `src/audio-dsp/filter-stack.test.ts`
- Modify: `src/engines/engine-params.ts` (the `optionsFrom` field)
- Modify: `src/engines/engine-param-grid.ts` (build options from it; rebuild on change)
- Modify: `src/engines/engine-types.ts` (`EngineUIContext.rebuildParamUI`)
- Modify: `src/engines/subtractive-params.ts`, `src/audio-dsp/types.ts`, `src/audio-dsp/default-params.ts`, `src/audio-dsp/subtractive-renderer.ts`
- Modify: `src/audio-dsp/subtractive-renderer.test.ts`, `src/presets/subtractive-unison-presets.test.ts`, `src/audio-dsp/live-params.dsp.test.ts`, `tools/verify-defaults-unchanged.mjs`, `tools/param-access-bench.mjs`, `tools/bench-unison.mjs`
- Test: `src/engines/engine-param-grid.test.ts` (the dependent-options case)

**Interfaces produced (later tasks depend on these):**
- `FILTER_MODES: readonly FilterMode[]` where `FilterMode = { value, label, taps: FilterTap[] }`
- `FilterTap = 'lp' | 'hp' | 'bp' | 'notch' | 'comb+' | 'comb-' | 'combff'`
- `tapFor(model: number, type: number): FilterTap`
- `typeOptionsFor(model: number): { value: string; label: string }[]`
- params `filter.model` (0..3) and `filter.type` (0..3), replacing `filter.kind`
- `SubParams.filterModel` / `SubParams.filterType`, replacing `filterKind`

- [ ] **Step 1: Write the failing tests**

Replace the two describes in `src/audio-dsp/filter-stack.test.ts` that walk `FILTER_KINDS` (`the filter kind table` and `every entry in the list does what its label says`, plus `no entry is a silent alias of another`) with these. Keep `passes()`, `noise()`, `throughKind()`, `rms`, `divergence` and the `trackedCutoff` describe exactly as they are — only their inputs change from a kind index to a (model, type) pair.

```ts
import { FILTER_MODES, tapFor, typeOptionsFor, type FilterTap } from './filter-kinds';

/** Every (mode, tap) pair the table declares, as [modelIdx, typeIdx, label]. */
const PAIRS: Array<[number, number, string]> = FILTER_MODES.flatMap((m, mi) =>
  m.taps.map((t, ti) => [mi, ti, `${m.label} ${t}`] as [number, number, string]),
);

describe('the mode table', () => {
  it('is three circuits and every one declares at least two taps', () => {
    // COMB is deliberately NOT here yet: its DSP is the next task, and a mode
    // declared before its circuit exists is a Mode button whose three Type
    // buttons all fall through to a lowpass. A one-option control would be its
    // own smaller lie — a label pretending to be a choice.
    expect(FILTER_MODES).toHaveLength(3);
    for (const m of FILTER_MODES) expect(m.taps.length, m.label).toBeGreaterThan(1);
  });

  it('starts at the current default, so a patch that says nothing is unchanged', () => {
    expect(FILTER_MODES[0].value).toBe('dig');
    expect(FILTER_MODES[0].taps[0]).toBe('lp');
  });

  it('keeps every existing preset value meaning what it meant', () => {
    // DIG/MOG/303 at 0/1/2, and each declaring its taps in the order the old
    // Type control used. Six values in the preset pack depend on this.
    expect(FILTER_MODES.map((m) => m.value)).toEqual(['dig', 'mog', 'acid']);
    expect(FILTER_MODES[0].taps).toEqual(['lp', 'hp', 'bp', 'notch']);
    expect(FILTER_MODES[1].taps).toEqual(['lp', 'hp', 'bp']);
    expect(FILTER_MODES[2].taps).toEqual(['lp', 'hp', 'bp']);
  });

  it('never lets a ladder declare a notch — the one response they cannot do', () => {
    for (const m of FILTER_MODES) {
      if (m.value === 'mog' || m.value === 'acid') expect(m.taps).not.toContain('notch');
    }
  });
});

describe('tapFor', () => {
  it('names a tap the mode really has, for every model and every type', () => {
    for (let mi = 0; mi < FILTER_MODES.length; mi++) {
      for (const ti of [-3, 0, 1, 2, 3, 9]) {
        expect(FILTER_MODES[mi].taps, `mode ${mi} type ${ti}`).toContain(tapFor(mi, ti));
      }
    }
  });

  it('clamps rather than wrapping, so an out-of-range type lands on the last tap', () => {
    expect(tapFor(1, 9)).toBe('bp');    // MOG has lp, hp, bp
    expect(tapFor(1, -1)).toBe('lp');
  });
});

describe('the Type control offers exactly the declared taps', () => {
  // No lying buttons, as an assertion: the option list the UI builds must be
  // the mode's tap list, no extra button and no missing one.
  it.each(FILTER_MODES.map((m, i) => [m.label, i] as const))('%s', (_label, mi) => {
    expect(typeOptionsFor(mi)).toHaveLength(FILTER_MODES[mi].taps.length);
    expect(typeOptionsFor(mi).map((o) => o.value)).toEqual(FILTER_MODES[mi].taps);
  });
});

describe('every declared pair does what it says', () => {
  const lp = PAIRS.filter(([m, t]) => tapFor(m, t) === 'lp');
  const hp = PAIRS.filter(([m, t]) => tapFor(m, t) === 'hp');
  const bp = PAIRS.filter(([m, t]) => tapFor(m, t) === 'bp');
  const notch = PAIRS.filter(([m, t]) => tapFor(m, t) === 'notch');

  it('the lowpasses pass what is under the cutoff and stop what is over it', () => {
    for (const [m, t, label] of lp) expect(passes(m, t, LOW), label).toBeGreaterThan(passes(m, t, HIGH) * 10);
  });

  it('the highpasses are the mirror image', () => {
    for (const [m, t, label] of hp) expect(passes(m, t, HIGH), label).toBeGreaterThan(passes(m, t, LOW) * 10);
  });

  it('the bandpasses pass the cutoff and reject both sides', () => {
    for (const [m, t, label] of bp) {
      expect(passes(m, t, AT), label).toBeGreaterThan(passes(m, t, LOW) * 5);
      expect(passes(m, t, AT), label).toBeGreaterThan(passes(m, t, HIGH) * 5);
    }
  });

  it('the notch is a hole where the bandpass has its peak', () => {
    for (const [m, t, label] of notch) {
      expect(passes(m, t, AT), label).toBeLessThan(passes(m, t, LOW) * 0.2);
      expect(passes(m, t, AT), label).toBeLessThan(passes(m, t, HIGH) * 0.2);
    }
  });
});

describe('no declared pair is a silent alias of another', () => {
  it('all of them differ from each other through the same signal', () => {
    const input = noise(SR * 0.1);
    const rendered = PAIRS.map(([m, t]) => throughPair(m, t, input));
    for (let a = 0; a < rendered.length; a++) {
      for (let b = a + 1; b < rendered.length; b++) {
        expect(divergence(rendered[a], rendered[b]), `${PAIRS[a][2]} vs ${PAIRS[b][2]}`)
          .toBeGreaterThan(0.01);
      }
    }
  });
});
```

Change the two helpers to take a pair instead of a kind index — `passes(model, type, hz)` and `throughPair(model, type, input)` — building the stack as `new FilterStack(model, type, 0, 0, ROUTING_OFF, SR)` (the new constructor, see Step 3). Keep `passes()`'s RMS-about-the-mean and its comment: the diode ladder rectifies, and that is still true.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts`
Expected: FAIL — `FILTER_MODES` / `tapFor` / `typeOptionsFor` are not exported.

- [ ] **Step 3: Reshape the table and the block**

Rewrite `src/audio-dsp/filter-kinds.ts`'s table half. Keep the file's header comment about why the notch is missing from the ladders; replace the `FilterKind` interface, `FILTER_KINDS` and `FILTER_KIND_OPTIONS` with:

```ts
export type FilterTap = 'lp' | 'hp' | 'bp' | 'notch' | 'comb+' | 'comb-' | 'combff';

export interface FilterMode {
  /** Stable id for presets and saves. */
  value: string;
  /** What the Mode control shows. Short: the Type control says the response. */
  label: string;
  /** The responses this circuit produces HONESTLY, in the order the Type
   *  control paints them. It is the option list, so a tap that is not here is
   *  not a button — which is the whole point. */
  taps: FilterTap[];
}

/** Index = the `filter.model` / `filter2.model` param value. 0..2 are DIG, MOG
 *  and 303 exactly as they have always been numbered, and each declares its taps
 *  in the order the old Type control used — so every preset value and every old
 *  save keeps the sound it stored. */
export const FILTER_MODES: readonly FilterMode[] = [
  { value: 'dig',  label: 'DIG',  taps: ['lp', 'hp', 'bp', 'notch'] },
  { value: 'mog',  label: 'MOG',  taps: ['lp', 'hp', 'bp'] },
  { value: 'acid', label: '303',  taps: ['lp', 'hp', 'bp'] },
  // COMB is NOT here yet. Its row and its DSP land together in Task 2, because
  // a mode declared before its circuit exists is a Mode button whose three Type
  // buttons all fall through to a lowpass — three lying buttons, which is the
  // one thing this round exists to remove.
];

const TAP_LABELS: Record<FilterTap, string> = {
  lp: 'LP', hp: 'HP', bp: 'BP', notch: 'NOTCH',
  'comb+': 'POS', 'comb-': 'NEG', combff: 'FF',
};

const clampIdx = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(v)));

/** The tap a (model, type) pair names. `type` indexes the MODE'S OWN taps and is
 *  clamped, so every pair — including one a hand-edited preset invented — names a
 *  response that mode really has. There is no invalid pair to resolve. */
export function tapFor(model: number, type: number): FilterTap {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps[clampIdx(type, m.taps.length)];
}

/** The Type control's options for a mode. The UI builds its buttons from this
 *  and nothing else. */
export function typeOptionsFor(model: number): Array<{ value: string; label: string }> {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps.map((t) => ({ value: t, label: TAP_LABELS[t] }));
}

export const FILTER_MODE_OPTIONS = FILTER_MODES.map((m) => ({ value: m.value, label: m.label }));
```

In `src/audio-dsp/filter-stack.ts`, `FilterBlock`'s constructor takes `(model: number, type: number, sr: number)` and resolves through the table:

```ts
  constructor(model: number, type: number, sr: number) {
    const mode = FILTER_MODES[Math.max(0, Math.min(FILTER_MODES.length - 1, Math.round(model)))];
    this.tap = tapFor(model, type);
    if (mode.value === 'mog' || mode.value === 'acid') {
      this.ladder = new LadderFilter(mode.value === 'mog' ? 'moog' : 'diode', sr, this.tap as LadderTap);
    } else {
      this.svf = new Svf(sr);
    }
  }
```

and `FilterStack`'s constructor becomes
`constructor(modelA: number, typeA: number, modelB: number, typeB: number, routing: number, sr: number)`.

- [ ] **Step 4: Bring back the two params**

In `src/engines/subtractive-params.ts`, replace the single `filter.kind` spec with two. The `optionsFrom` field is new — Step 5 adds it to the type and the grid:

```ts
  // Mode picks the circuit; Type picks the response — and Type offers EXACTLY
  // the responses that circuit can honestly produce (audio-dsp/filter-kinds.ts).
  // Choose MOG and the NOTCH button is not there, rather than being there and
  // quietly handing back a lowpass, which is what the old grid did.
  // max is the highest index that EXISTS. Task 2 raises it to 3 when COMB does.
  { id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 2, default: 0,
    options: FILTER_MODE_OPTIONS, group: 'filter' },
  { id: 'filter.type',  label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
    options: typeOptionsFor(0), optionsFrom: { paramId: 'filter.model', build: typeOptionsFor },
    group: 'filter' },
```

In `src/audio-dsp/types.ts`, `SubParams.filterKind` becomes two fields:

```ts
  filterModel: number;      // index into FILTER_MODES (audio-dsp/filter-kinds.ts)
  filterType: number;       // index into THAT mode's own taps, clamped
```

In `src/audio-dsp/default-params.ts`, `filterKind: 0` becomes `filterModel: 0, filterType: 0`.

In `src/audio-dsp/subtractive-renderer.ts`: `subParamsInto` reads `out.filterModel = param(b, 'filter.model', 0)` and `out.filterType = param(b, 'filter.type', 0)`, and the constructor builds `new FilterStack(p.filterModel, p.filterType, 0, 0, ROUTING_OFF, sampleRate)`.

- [ ] **Step 5: Teach the grid to build options from another param**

In `src/engines/engine-params.ts`, add to `EngineParamSpec`:

```ts
  /** Discrete params only: build this control's options from ANOTHER param's
   *  current value, and rebuild the control when that param changes. It is how
   *  a control offers only what the rest of the patch makes honest — the filter
   *  Type offers only the taps the chosen Mode has. `options` stays as the list
   *  for the source param's DEFAULT value, so anything that reads the spec
   *  statically (a destination catalogue, a test) still sees a valid list. */
  optionsFrom?: { paramId: string; build: (value: number) => Array<{ value: string; label: string }> };
```

In `src/engines/engine-types.ts`, add to `EngineUIContext`:

```ts
  /** Rebuild the whole engine param UI. Provided by whoever owns the container
   *  the grid was built into. The grid calls it when a param changes that another
   *  param's options are derived from (see EngineParamSpec.optionsFrom) — the
   *  controls are built once into a detached fragment (select-control.ts), so a
   *  changed option list means a new control, not a mutated one. */
  rebuildParamUI?: () => void;
```

In `src/engines/engine-param-grid.ts`'s `buildControl`, inside the `if (discrete)` branch:

```ts
    const options = spec.optionsFrom
      ? spec.optionsFrom.build(engine.getBaseValue(spec.optionsFrom.paramId))
      : spec.options!;
```

and in that branch's `onChange`, after the `commitParam` call:

```ts
        // If another param's options are derived from this one, its control is
        // now showing a stale list — rebuild the grid rather than surgically
        // replacing it (the caller already rebuilds on engine swap).
        if (engine.params.some((s) => s.optionsFrom?.paramId === spec.id)) ctx.rebuildParamUI?.();
```

Then find the caller that owns the container it builds into (start at `src/session/session-inspector.ts` and `src/session/lane-editor-panels.ts`; `grep -rn "buildParamUI\|buildEngineParamGrid" src/`) and pass `rebuildParamUI` in the context it constructs, pointing at its own existing "rebuild this lane's param UI" path. If no such path exists at that call site, report DONE_WITH_CONCERNS describing what you found rather than inventing a lifecycle.

- [ ] **Step 6: Write the grid's own test**

Add to `src/engines/engine-param-grid.test.ts`:

```ts
  it('builds a dependent control\'s options from the param it derives from', () => {
    // The filter Type offers only the taps the chosen Mode has. Built at
    // mode 1 (MOG), the strip must have three buttons, not four.
    const engine = makeGridEngine([
      { id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 3, default: 0,
        options: FILTER_MODE_OPTIONS },
      { id: 'filter.type', label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
        options: typeOptionsFor(0), optionsFrom: { paramId: 'filter.model', build: typeOptionsFor } },
    ], { 'filter.model': 1 });
    const host = document.createElement('div');
    buildEngineParamGrid(engine, makeCtx(), host, {});
    const typeButtons = host.querySelectorAll('[data-param="filter.type"] button, [data-param="filter.type"] option');
    expect(typeButtons.length).toBe(3);
  });
```

Follow the file's existing helpers for building a fake engine and context — read the top of `engine-param-grid.test.ts` and reuse whatever it already has rather than adding new fakes. If the rendered DOM does not carry a `data-param` hook, select the control by its label text instead and say so in your report.

- [ ] **Step 7: Update the callers of the old id**

`filter.kind` disappears. Update: `src/audio-dsp/subtractive-renderer.test.ts` (its `filter kind` describe becomes `filter mode and type`, with `'filter.model'` / `'filter.type'` in the bags — the LP/HP/BP/NOTCH indices are 0/1/2/3 under DIG), `src/presets/subtractive-unison-presets.test.ts` (back to `p.params['filter.type']` being 2 for `LEAD Razor` and 1 for `PAD Ethereal`), `src/audio-dsp/live-params.dsp.test.ts` (`{ 'filter.model': 1 }`), and the three `tools/*.mjs` scripts.

**The preset pack needs NO edit.** The six values that name the filter were converted to `filter.kind` by the superseded task; convert them BACK: `"filter.kind": 1` → `"filter.model": 1` (four presets), `"filter.kind": 6` → `"filter.type": 2` (`LEAD Razor`), `"filter.kind": 3` → `"filter.type": 1` (`PAD Ethereal`). Then `grep -c 'filter\.kind' public/presets/subtractive.json` must return `0`.

- [ ] **Step 8: Run everything**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: typecheck silent, suite green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat(subtractive): Mode x Type, with Type offering only what Mode can do

The flat ten-entry list is gone. Mode picks the circuit and Type picks the
response -- but Type's buttons ARE the chosen mode's declared taps, so
under MOG or 303 there is no NOTCH button to press. The old grid's defect
was never that it had two controls; it was that it offered twelve
combinations and only ten worked.

`type` indexes the mode's OWN tap list and is clamped, which makes an
invalid pair unrepresentable rather than merely unreachable -- no
resolution rule, no fallback, nothing to test for a state that cannot
exist. The ids stay filter.model and filter.type with DIG/MOG/303 at
0/1/2, so all six preset values and every old save keep their meaning.

EngineParamSpec.optionsFrom is the general mechanism: a discrete control
whose options are built from another param's value, rebuilt when it
changes. The filter Type is its first user.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: COMB, the fourth circuit

The mode's table row and its DSP land in the SAME commit, on purpose: a mode
declared before its circuit exists is a Mode button whose three Type buttons all
fall through to a lowpass, and "no lying buttons" does not have an exception for
work in progress. (Task 1 tried it the other way round; its own alias test caught
it.)

**Files:**
- Create: `src/audio-dsp/comb.ts`
- Modify: `src/audio-dsp/filter-kinds.ts` (the fourth row)
- Modify: `src/audio-dsp/filter-stack.ts`
- Modify: `src/engines/subtractive-params.ts` (`filter.model` max 2 → 3)
- Test: `src/audio-dsp/comb.test.ts`, `src/audio-dsp/filter-stack.test.ts`

**Interfaces:**
- Consumes: `FilterTap`, `FILTER_MODES` from Task 1 — the comb taps are already
  in the `FilterTap` union and in `TAP_LABELS`, with no table row using them yet.
- Produces: `class CombFilter { constructor(sr: number); update(x: number, tuneHz: number, feedback: number, tap: FilterTap): number }`, and the fourth `FILTER_MODES` entry.

- [ ] **Step 1: Write the failing test**

Create `src/audio-dsp/comb.test.ts`:

```ts
// src/audio-dsp/comb.test.ts
// A comb is a delay summed back on itself, so it does not shape one corner --
// it shapes a whole series of evenly spaced peaks. Its three taps differ by
// WHERE those peaks land, which is what these tests measure.
import { describe, it, expect } from 'vitest';
import { CombFilter } from './comb';

const SR = 48000;
const TUNE = 200;   // peaks spaced 200 Hz apart

/** Level of a steady sine at `hz` through the comb, past the run-in. */
const passes = (tap: 'comb+' | 'comb-' | 'combff', hz: number, fb = 0.8): number => {
  const c = new CombFilter(SR);
  let acc = 0, n = 0;
  for (let i = 0; i < SR * 0.3; i++) {
    const y = c.update(Math.sin(2 * Math.PI * hz * i / SR), TUNE, fb, tap);
    if (i > SR * 0.15) { acc += y * y; n++; }   // long run-in: the loop has to settle
  }
  return Math.sqrt(acc / n);
};

describe('the positive comb', () => {
  it('reinforces every harmonic of its tuning', () => {
    // 200, 400 and 600 all sit on peaks; 300 sits between two of them.
    expect(passes('comb+', 400)).toBeGreaterThan(passes('comb+', 300) * 3);
    expect(passes('comb+', 600)).toBeGreaterThan(passes('comb+', 300) * 3);
  });
});

describe('the negative comb', () => {
  it('reinforces the ODD harmonics and cancels the even ones', () => {
    // This is the difference between a plucked string and a stopped pipe, and
    // it is the whole reason NEG is its own tap rather than a variant of POS.
    expect(passes('comb-', 300)).toBeGreaterThan(passes('comb-', 400) * 3);
  });

  it('is a different sound from the positive comb at the same tuning', () => {
    expect(passes('comb-', 400)).toBeLessThan(passes('comb+', 400) * 0.4);
  });
});

describe('the feed-forward comb', () => {
  it('notches instead of ringing', () => {
    // No feedback path, so the peaks do not grow; what it does is cut.
    expect(passes('combff', 300)).toBeLessThan(passes('combff', 400) * 0.5);
  });

  it('cannot ring however hard the feedback knob is pushed', () => {
    // Its peak level barely moves with feedback, because there is none.
    const soft = passes('combff', 400, 0.1);
    const hard = passes('combff', 400, 0.99);
    expect(hard).toBeLessThan(soft * 2);
  });
});

describe('every comb stays bounded', () => {
  it('does not run away at maximum feedback', () => {
    for (const tap of ['comb+', 'comb-', 'combff'] as const) {
      const c = new CombFilter(SR);
      let peak = 0;
      for (let i = 0; i < SR * 0.5; i++) {
        const y = c.update(Math.sin(2 * Math.PI * 200 * i / SR), TUNE, 1.5, tap);
        expect(Number.isFinite(y), `${tap} went non-finite`).toBe(true);
        const a = Math.abs(y); if (a > peak) peak = a;
      }
      // A resonant comb legitimately rings well above unity; what must not
      // happen is unbounded growth. 20x is a runaway detector, not a target.
      expect(peak, `${tap} blew up`).toBeLessThan(20);
    }
  });

  it('holds its tuning at the bottom of the knob', () => {
    // The delay line is sized once, so the lowest tuning is capped in the DSP
    // rather than left to the knob: a per-voice buffer times an uncapped poly
    // lane is real memory.
    const c = new CombFilter(SR);
    for (let i = 0; i < 100; i++) expect(Number.isFinite(c.update(1, 1, 0.9, 'comb+'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/comb.test.ts`
Expected: FAIL — `Failed to resolve import "./comb"`.

- [ ] **Step 3: Write the comb**

Create `src/audio-dsp/comb.ts`:

```ts
// src/audio-dsp/comb.ts
// A comb filter: the signal plus a delayed copy of itself. Where the three
// existing circuits shape ONE corner, this one shapes a whole harmonic series
// at once -- the delayed copy reinforces every frequency whose period fits the
// delay and cancels the ones that fall between.
//
// Three taps, three genuinely different responses:
//   comb+   y = x + g*y[n-D]   peaks on EVERY harmonic of the tuning (a string)
//   comb-   y = x - g*y[n-D]   peaks on the ODD harmonics only (a stopped pipe)
//   combff  y = x + g*x[n-D]   no feedback at all: notches, and no ringing
//
// POS and NEG differ by a sign and sound nothing alike; cancelling the even
// harmonics is what makes a clarinet a clarinet.

import type { FilterTap } from './filter-kinds';

/** The lowest tuning the comb will accept. The delay line is sized for it once,
 *  per voice, and poly lanes are uncapped by design -- 30 Hz at 48 kHz is 1600
 *  samples, which is a buffer worth allocating; 5 Hz would be six times that for
 *  a pitch nobody plays. */
const MIN_TUNE_HZ = 30;

export class CombFilter {
  private readonly buf: Float32Array;
  private readonly size: number;
  private w = 0;

  constructor(private sr: number) {
    // +2 so the read index can never collide with the write index after rounding.
    this.size = Math.ceil(sr / MIN_TUNE_HZ) + 2;
    this.buf = new Float32Array(this.size);
  }

  /**
   * One sample.
   * @param tuneHz    the frequency the peaks are spaced by (the Cutoff knob)
   * @param feedback  0..1 how much comes back (the Resonance knob)
   */
  update(x: number, tuneHz: number, feedback: number, tap: FilterTap): number {
    const hz = tuneHz < MIN_TUNE_HZ ? MIN_TUNE_HZ : tuneHz > this.sr * 0.45 ? this.sr * 0.45 : tuneHz;
    const delay = Math.min(this.size - 1, Math.max(1, Math.round(this.sr / hz)));
    let r = this.w - delay;
    if (r < 0) r += this.size;
    const delayed = this.buf[r];

    // Strictly under 1: at 1 the loop never decays and the comb becomes an
    // oscillator that outlives the note.
    const g = feedback < 0 ? 0 : feedback > 0.97 ? 0.97 : feedback;

    let out: number;
    if (tap === 'combff') {
      // Feed-FORWARD: the delayed INPUT, not the delayed output. Nothing
      // circulates, so this one cannot ring however far the knob is pushed.
      out = x + g * delayed;
      this.buf[this.w] = x;
    } else {
      const s = tap === 'comb-' ? -1 : 1;
      out = x + s * g * delayed;
      this.buf[this.w] = out;
    }
    this.w = this.w + 1 >= this.size ? 0 : this.w + 1;
    // Two paths summed can reach 2x before the feedback even starts; halving
    // keeps a comb roughly level with the other three circuits.
    return out * 0.5;
  }
}
```

Note for the implementer: `combff` writes the INPUT to the buffer and the others write the OUTPUT. That is the whole difference between a feed-forward and a feedback comb, and getting it backwards makes `combff` ring — which its own test catches.

- [ ] **Step 4: Run it to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/comb.test.ts`
Expected: PASS.

If "reinforces the ODD harmonics" fails, check the sign, not the threshold. If "cannot ring" fails, the feed-forward path is writing the output.

- [ ] **Step 5: Declare the mode and wire it into the stack**

Now — and only now, with a real circuit behind it — add the fourth row to
`FILTER_MODES` in `src/audio-dsp/filter-kinds.ts`, replacing the comment that
says it is coming:

```ts
  { value: 'comb', label: 'COMB', taps: ['comb+', 'comb-', 'combff'] },
```

Raise `filter.model`'s `max` from 2 to 3 in `src/engines/subtractive-params.ts`
(and drop the comment saying Task 2 would).

In `src/audio-dsp/filter-stack.ts`, `FilterBlock` gains a comb branch:

```ts
  private comb: CombFilter | null = null;
```

and in the constructor:

```ts
    if (mode.value === 'comb') this.comb = new CombFilter(sr);
    else if (mode.value === 'mog' || mode.value === 'acid') { /* ...ladder as before... */ }
    else this.svf = new Svf(sr);
```

Update the two mode-table tests in `filter-stack.test.ts` that Task 1 pinned at
three circuits: the count becomes 4 and the `value` list gains `'comb'`. Their
"COMB is deliberately not here yet" comments come out — the reason is spent.

and in `update`, before the ladder branch:

```ts
    // Under COMB the two knobs mean something else, and the manual says so:
    // cutoffHz is the comb's TUNING and res is its feedback.
    if (this.comb) return this.comb.update(x, cutoffHz, res, this.tap);
```

- [ ] **Step 6: Run the stack tests**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts src/audio-dsp/comb.test.ts`
Expected: PASS — including "no declared pair is a silent alias of another", which now covers the three comb taps against the other seven pairs.

- [ ] **Step 7: Full suite and typecheck**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: typecheck silent, suite green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat(subtractive): COMB, a fourth circuit with three responses of its own

Where DIG, MOG and 303 all shape one corner, a comb shapes a whole
harmonic series: the delayed copy reinforces every frequency whose period
fits the delay and cancels the ones between.

Three taps because they are three different instruments, not three
settings. POS reinforces every harmonic and sounds like a plucked string;
NEG cancels the even ones and sounds like a stopped pipe -- the difference
is a sign, and it is the difference between a string and a clarinet; FF
has no feedback path at all, so it notches without ringing however far the
knob is pushed, which its own test pins.

Under COMB the Cutoff knob is the tuning and Resonance is the feedback.
Reinterpreting a knob is honest when it is said out loud, and the manual
says it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Series, parallel and difference

Fills in `FilterStack.combine`, the seam that currently returns filter A unchanged.

**Files:**
- Modify: `src/audio-dsp/filter-stack.ts`
- Test: `src/audio-dsp/filter-stack.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/filter-stack.test.ts`. `DIG_LP` is mode 0, type 0:

```ts
describe('routing', () => {
  const CLOSED = 300, OPEN = 4000;
  const DIG = 0, LP = 0;
  const tone = (hz: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * hz * i / SR));

  /** RMS of a steady tone through a stack, past the run-in. About the mean, for
   *  the same reason `passes` is: an asymmetric circuit rectifies. */
  const through = (
    routing: number, cutA: number, cutB: number, blend: number, hz: number,
  ): number => {
    const s = new FilterStack(DIG, LP, DIG, LP, routing, SR);
    const input = tone(hz, SR * 0.25);
    const kept: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const y = s.update(input[i], cutA, 0.25, cutB, 0.25, blend);
      if (i > SR * 0.02) kept.push(y);
    }
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    return Math.sqrt(kept.reduce((a, v) => a + (v - mean) * (v - mean), 0) / kept.length);
  };

  it('blend 0 is filter A alone, in every mode', () => {
    const solo = through(ROUTING_OFF, CLOSED, OPEN, 0, 440);
    for (const routing of [ROUTING_SER, ROUTING_PAR, ROUTING_DIFF]) {
      expect(through(routing, CLOSED, OPEN, 0, 440), `routing ${routing}`).toBeCloseTo(solo, 10);
    }
  });

  it('SERIES removes more than A alone — two lowpasses in a row', () => {
    expect(through(ROUTING_SER, OPEN, CLOSED, 1, 7040))
      .toBeLessThan(through(ROUTING_OFF, OPEN, CLOSED, 1, 7040) * 0.5);
  });

  it('PARALLEL passes what either branch passes', () => {
    // A closed, B open, the tone above A's cutoff and under B's: A alone loses
    // it and the parallel sum brings it back.
    expect(through(ROUTING_PAR, CLOSED, OPEN, 0.5, 2000))
      .toBeGreaterThan(through(ROUTING_OFF, CLOSED, OPEN, 0.5, 2000) * 2);
  });

  it('DIFFERENCE of two lowpasses is a band-pass between their cutoffs', () => {
    // This is why having the same filter twice is worth it: A minus B is a
    // response neither one can produce alone.
    const band = (hz: number) => through(ROUTING_DIFF, OPEN, CLOSED, 1, hz);
    expect(band(1200)).toBeGreaterThan(band(80) * 5);
    expect(band(1200)).toBeGreaterThan(band(12000) * 5);
  });

  it('every mode stays bounded with both filters resonant', () => {
    const input = noise(SR * 0.05);
    for (const routing of [ROUTING_SER, ROUTING_PAR, ROUTING_DIFF]) {
      for (const [mi, ti] of PAIRS.map(([m, t]) => [m, t] as const)) {
        const s = new FilterStack(mi, ti, (mi + 2) % 4, 0, routing, SR);
        let peak = 0;
        for (const x of input) {
          const y = s.update(x * 1.8, 900, 0.95, 300, 0.95, 1);
          expect(Number.isFinite(y), `routing ${routing} pair ${mi}/${ti} went non-finite`).toBe(true);
          const a = Math.abs(y); if (a > peak) peak = a;
        }
        expect(peak, `routing ${routing} pair ${mi}/${ti} blew up`).toBeLessThan(20);
      }
    }
  });
});
```

Add `ROUTING_SER, ROUTING_PAR, ROUTING_DIFF` to the file's import from `./filter-stack`.

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts`
Expected: FAIL — `combine` returns filter A unchanged, so SERIES removes nothing, PARALLEL adds nothing and DIFFERENCE is not a band. ("blend 0 is filter A alone" passes already: it is the one thing the seam gets right.)

- [ ] **Step 3: Fill in the three modes**

Extend `filter-stack.ts`'s import to include `ROUTING_SER, ROUTING_PAR, ROUTING_DIFF`, and replace `combine`'s body:

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
      // band-pass between their cutoffs, which no single circuit here is.
      case ROUTING_DIFF: return a - blend * b.update(x, cutB, resB);
      default: return a;
    }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter-stack.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add -A
git commit -F- <<'EOF'
feat(subtractive): series, parallel and difference between the two filters

Blend 0 is filter A alone in every mode, series removes more than A alone,
parallel passes what either branch passes, and the difference of two
lowpasses is a band-pass between their cutoffs -- the response that makes
having the same filter in both slots worth something.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Filter B reaches the engine

**Files:**
- Modify: `src/engines/subtractive-params.ts`, `src/engines/subtractive.ts`
- Modify: `src/audio-dsp/types.ts`, `src/audio-dsp/default-params.ts`, `src/audio-dsp/subtractive-renderer.ts`
- Test: `src/audio-dsp/subtractive-renderer.test.ts`, `src/engines/subtractive-layout.test.ts`

**Interfaces produced:** params `filter.routing`, `filter.blend`, `filter2.model`, `filter2.type`, `filter2.cutoff`, `filter2.resonance`, `filter2.track`; the matching `SubParams` fields.

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/subtractive-renderer.test.ts`:

```ts
describe('the second filter', () => {
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
    const b = render({ 'filter.routing': 0, 'filter2.model': 0, 'filter2.type': 1, 'filter2.cutoff': 0.4 });
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });

  it('changes the sound once the routing turns it on', () => {
    // Series into a highpass: the low end goes, so this cannot be a no-op.
    const on = render({ 'filter.routing': 1, 'filter2.model': 0, 'filter2.type': 1, 'filter2.cutoff': 0.6, 'filter.blend': 1 });
    expect(rms(on)).toBeLessThan(rms(render({ 'filter.routing': 0 })) * 0.8);
  });

  it('honours Blend — half of B is between none and all of it', () => {
    const level = (blend: number) => rms(render({
      'filter.routing': 1, 'filter2.model': 0, 'filter2.type': 1, 'filter2.cutoff': 0.6, 'filter.blend': blend,
    }));
    expect(level(0.5)).toBeLessThan(level(0));
    expect(level(0.5)).toBeGreaterThan(level(1));
  });

  it('reaches Blend live, so an LFO moves the routing itself', () => {
    const bag: ParamBag = {
      ...base, 'filter.routing': 1, 'filter2.model': 0, 'filter2.type': 1,
      'filter2.cutoff': 0.6, 'filter.blend': 0.5,
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
    // still drives the tracking ratio: a still B is a still sound, a following
    // B is a sound that changes across the note.
    const variation = (track: number): number => {
      const b = render({
        'filter.routing': 2, 'filter.blend': 1,
        'filter2.model': 0, 'filter2.type': 1, 'filter2.cutoff': 0.35, 'filter2.track': track,
        'filter.builtinEnv': 1, 'filter.envAmount': 0.9, 'filter.cutoff': 0.3,
        'filter.attack': 0.001, 'filter.decay': 0.35, 'filter.sustain': 0.05, 'filter.release': 0.2,
      }, 0.3);
      const half = Math.floor(b.length / 2);
      return Math.abs(rms(b.slice(half)) - rms(b.slice(0, half))) / Math.max(1e-9, rms(b));
    };
    expect(variation(1)).toBeGreaterThan(variation(0) * 3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/subtractive-renderer.test.ts`
Expected: FAIL — "changes the sound once the routing turns it on" fails; `filter.routing` is not a param the renderer reads yet.

- [ ] **Step 3: Declare the seven params**

In `src/engines/subtractive-params.ts`, after `filter.keyTrack`:

```ts
  // Filter B and the routing between the two. Routing OFF is the default and
  // means filter B is never built, so a patch that says nothing about it renders
  // exactly what it always did.
  //
  // Routing, both models and both types are discrete AND structural — read once
  // at trigger, for the reason the filter model has always been: a topology is
  // not something you sweep mid-note. Cutoff, Res, Track and Blend are
  // continuous, read every sample, and modulation destinations for free.
  { id: 'filter.routing',    label: 'Routing', kind: 'discrete', min: 0, max: 3, default: 0,
    options: FILTER_ROUTING_OPTIONS, group: 'filter2' },
  { id: 'filter2.model',     label: 'Mode',    kind: 'discrete', min: 0, max: 3, default: 0,
    options: FILTER_MODE_OPTIONS, group: 'filter2' },
  { id: 'filter2.type',      label: 'Type',    kind: 'discrete', min: 0, max: 3, default: 1,
    options: typeOptionsFor(0), optionsFrom: { paramId: 'filter2.model', build: typeOptionsFor },
    group: 'filter2' },
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

In `src/engines/subtractive.ts`, split the `filter` group row into two:

```ts
  { id: 'filter',  title: 'FILTER A', row: 1, color: 'var(--knob-orange)' },
  { id: 'filter2', title: 'FILTER B', row: 1, color: 'var(--knob-teal)' },
```

- [ ] **Step 4: Extend the snapshot**

`src/audio-dsp/types.ts`, after `filterType`:

```ts
  filterRouting: number;    // 0 = off, 1 = series, 2 = parallel, 3 = difference
  filterBlend: number;      // 0..1 how much of filter B is in the result
  filter2Model: number; filter2Type: number;
  filter2Cutoff: number; filter2Resonance: number;
  filter2Track: number;     // 0..1 how far B follows A's envelope + key track
```

`src/audio-dsp/default-params.ts`, after `filterModel: 0, filterType: 0,`:

```ts
    filterRouting: 0, filterBlend: 1,
    filter2Model: 0, filter2Type: 1, filter2Cutoff: 0.25, filter2Resonance: 0.2, filter2Track: 0,
```

- [ ] **Step 5: Wire the renderer**

Import `trackedCutoff` alongside `FilterStack` and drop `ROUTING_OFF`.

`subParamsInto` gains the seven reads (`param(b, 'filter.routing', 0)`, `param(b, 'filter.blend', 1)`, `param(b, 'filter2.model', 0)`, `param(b, 'filter2.type', 1)`, `param(b, 'filter2.cutoff', 0.25)`, `param(b, 'filter2.resonance', 0.2)`, `param(b, 'filter2.track', 0)`).

Four new live slots beside the existing ones, resolved in `setLiveValues`:

```ts
  private sFilter2Cutoff = -1;
  private sFilter2Resonance = -1;
  private sFilter2Track = -1;
  private sFilterBlend = -1;
```

```ts
    this.sFilter2Cutoff = slotOf(index, 'filter2.cutoff');
    this.sFilter2Resonance = slotOf(index, 'filter2.resonance');
    this.sFilter2Track = slotOf(index, 'filter2.track');
    this.sFilterBlend = slotOf(index, 'filter.blend');
```

A cache pair beside `cutRaw` / `cutHzCached`:

```ts
  private cut2Raw = NaN;
  private cut2HzCached = 0;
```

The constructor builds the real stack:

```ts
    this.stack = new FilterStack(
      p.filterModel, p.filterType, p.filter2Model, p.filter2Type, p.filterRouting, sampleRate,
    );
```

And in `renderSample`, replace the single-filter call with filter B's live reads and the real one:

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

- [ ] **Step 6: Update the layout test**

In `src/engines/subtractive-layout.test.ts`, the FILTER row now holds two sections:

```ts
      ['OSC 1', 'OSC 2', 'RING', 'SUB', 'NOISE'], ['FILTER A', 'FILTER B'], ['MASTER'], ['POLY'],
```

and in the colour test replace the `FILTER` line with `FILTER A` → `var(--knob-orange)` and `FILTER B` → `var(--knob-teal)`.

- [ ] **Step 7: Run everything**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: typecheck silent, suite green. `declared-params.dsp.test.ts` and `live-params.dsp.test.ts` matter most here.

- [ ] **Step 8: Check the renderer's size**

```bash
grep -vcE '^\s*(//|/\*|\*|$)' src/audio-dsp/subtractive-renderer.ts
```

Report the number. Under 500 is the cap; if it is over 380, report it rather than refactoring on your own initiative.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat(subtractive): a second filter, and a routing control over the two

FILTER B with its own Mode, Type, Cutoff and Res, plus Track -- how much
of everything that MOVES filter A (its envelope, its key tracking) B
follows, as a RATIO, so the interval between the two stays constant in
octaves instead of collapsing the moment the envelope opens.

Routing is OFF by default and filter B is not even built there, so every
existing patch is bit-identical. Cutoff, Res, Track and Blend are
continuous and read live, so the knobs move the note already sounding and
a modulator reaches them with nothing further to declare.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: The manual

**Files:**
- Modify: `docs/manual/04-engines.md`, `public/presets/ATTRIBUTION.md`

- [ ] **Step 1: Replace the filter section**

In `docs/manual/04-engines.md`, replace the whole `### Filter model and type` section — including its "only DIG is a true multimode filter … with Model set to MOG or 303, the Type dropdown has no effect" warning, which has been false since the ladders got honest HP and BP taps — with:

```markdown
### Mode and Type

Two controls. **Mode** picks the circuit; **Type** picks the response you take
out of it — and Type only ever offers the responses that circuit can honestly
produce.

| Mode | Slope | Character | Types it offers |
| --- | --- | --- | --- |
| **DIG** (default) | 12 dB/oct | A clean state-variable filter. Precise and neutral, and what most presets are voiced against. | LP, HP, BP, NOTCH |
| **MOG** | 24 dB/oct | A four-pole Moog-style ladder. Warmer, and it thins as it resonates. | LP, HP, BP |
| **303** | 24 dB/oct | The diode ladder from the TB-303. Asymmetric clipping adds even harmonics — the acid voice. | LP, HP, BP |
| **COMB** | — | A delay summed back on itself: a whole series of peaks instead of one corner. Metallic and hollow. | POS, NEG, FF |

**Why the ladders have no NOTCH.** A ladder's resonance feedback fills a notch's
null in, and on the diode model at high resonance the null inverts into a *peak*.
A notch that becomes a bump is not a notch, so under MOG or 303 the button is
not there — rather than being there and quietly handing you the lowpass, which
is what this used to do.

The ladders' HP and BP are the real thing, not the lowpass relabelled: a ladder
is four one-pole filters in a feedback loop, and the other responses come out of
its stage taps the same way the Oberheim Xpander derives its modes.

A second thing worth knowing about the ladders: they *lose* level as resonance
climbs, rather than growing a resonant peak on top. Turning Q up on MOG or 303
thins and quietens the sound. That is faithful to the hardware, and it is why
the TB-303 engine compensates with a dedicated accent gain.

### The comb, and its two borrowed knobs

Under **COMB** the filter delays the signal and adds it back to itself. The
delayed copy reinforces every frequency whose period fits the delay and cancels
the ones that fall between, so instead of one corner you get a series of evenly
spaced peaks — which is why it sounds like a plucked string or a hollow tube
rather than a filter.

Its three types are three different instruments:

| Type | What it does | Sounds like |
| --- | --- | --- |
| **POS** | Peaks on every harmonic of the tuning | a plucked string |
| **NEG** | Peaks on the ODD harmonics only | a stopped pipe, a clarinet |
| **FF** | No feedback: notches instead of peaks | a flanger frozen mid-sweep |

POS and NEG differ by a single sign and sound nothing alike — cancelling the
even harmonics is what makes a clarinet a clarinet.

Two knobs mean something else while COMB is selected, and it is worth knowing
before you reach for them:

- **Cutoff is the comb's TUNING** — the frequency its peaks are spaced by, not a
  corner frequency. Sweeping it slides the whole series.
- **Resonance is the feedback** — how much comes back round, so how long it
  rings and how sharp the peaks are. Under **FF** there is no feedback path at
  all, so it sets how deep the notches cut and cannot ring however far you push
  it.

### Two filters, and how they are wired

**FILTER B** is a second filter with its own Mode, Type, Cutoff and Res. It is
off until **Routing** says otherwise:

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
set separately, with its own resonance on each. No single circuit here produces
that, and it is why having the same filter in both slots is useful rather than
redundant.

**A comb added to a filter needs no special setting** — that is Filter A = DIG,
Filter B = COMB, Routing = Parallel, which IS a sum. Series combs what the
filter left, and Difference removes exactly what the comb reinforces.

**Track** (0–1) decides how filter B moves. Everything that sweeps filter A —
its envelope and its key tracking — is expressed as a ratio, and Track is how
much of that ratio B follows:

- **0** — B stays exactly where its knob puts it. The classic fixed high-pass
  sitting under a low-pass that sweeps.
- **1** — B moves by the same ratio as A, so the interval between the two stays
  constant in octaves. Two formants sweeping as a block.
```

Then update the parameter-sections list near the top of the Subtractive chapter,
replacing the single `- **FILTER**` bullet with FILTER A and FILTER B bullets
that link to the two sections above.

- [ ] **Step 2: Fix the stale attribution line**

In `public/presets/ATTRIBUTION.md`, the mpump porting table calls the ladder
models "**lossy** — 4-pole saturating ladder → Loom's 2-pole SVF". Loom has had
real ladders since. Point that row at `filter.model: 1` (MOG) / `2` (303) and
drop the "lossy" note for those two.

- [ ] **Step 3: Do NOT open a browser**

The visual check is the controller's job, once, over the finished branch —
starting a dev server inside a task races the other tasks' writes. Note in your
report that it is pending, and stop.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -F- <<'EOF'
docs(manual): Mode x Type, the comb's three responses, and the routing

The chapter claimed only DIG was a true multimode and that Type did
nothing on a ladder. That has been false since the ladders got honest HP
and BP taps; it is replaced by what each mode actually offers, why the
ladders have no notch, the comb's three types and its two borrowed knobs,
and what Difference is for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Presets that exercise the whole thing

Sixteen presets covering **every declared (mode, tap) pair, all four routing
modes and both ends of Track**, with the coverage asserted rather than trusted.

**Files:**
- Modify: `public/presets/subtractive.json`
- Test: `src/presets/subtractive-filter-presets.test.ts`

| Preset | A | Routing | B | Track | Modulator |
|---|---|---|---|---|---|
| `PAD Glass Air` | MOG HP | Off | — | — | — |
| `PAD Hollow Band` | DIG LP | Series | DIG HP | 0 | — |
| `LEAD Notch Vox` | DIG NOTCH | Off | — | — | LFO → `filter.cutoff` |
| `BASS Twin Growl` | 303 LP | Difference | MOG LP | 0.5 | LFO → `filter.blend` |
| `KEY Morph Two Ways` | 303 HP | Parallel | DIG BP | 0.6 | ADSR → `filter.blend` |
| `LEAD BP Sweep` | MOG BP | Parallel | 303 BP | 1 | LFO → `filter.cutoff` |
| `BASS Acid Diode` | 303 LP | Off | — | — | — |
| `PLUCK Thin Air` | DIG HP | Off | — | — | — |
| `LEAD Formant Two` | DIG BP | Parallel | MOG BP | 0 | — |
| `BASS Hollow Sub` | DIG NOTCH | Series | DIG LP | 0.3 | — |
| `PAD Phase Ghost` | DIG LP | Difference | DIG LP | 0 | LFO → `filter2.cutoff` |
| `LEAD Moog Cream` | MOG LP | Off | — | — | — |
| `STRING Comb Pluck` | COMB POS | Off | — | — | — |
| `PAD Clarinet Comb` | COMB NEG | Series | DIG LP | 0 | — |
| `FX Metal Comb` | DIG LP | Parallel | COMB FF | 1 | — (Ring 0.8) |
| `KEY Bell Ring` | DIG BP | Off | — | — | ADSR → `ring.level` |

Plus `PAD PWM Breather` (DIG LP, Off, LFO → `osc1.pw`) — the seventeenth, and the
first preset ever to put an LFO on the pulse width, which `ATTRIBUTION.md` has
been telling readers to do by hand since the width was exposed.

- [ ] **Step 1: Write the failing test**

Create `src/presets/subtractive-filter-presets.test.ts` with: the preset-name
list; an `it.each` that each one exists; an `it.each` that each renders above the
same silence floor the rest of the pack is held to (`rms > 0.01`, rendered
exactly as `subtractive-presets.test.ts` does — read that file and reuse its
`render` shape); and the coverage assertions:

```ts
  it('covers every (mode, tap) pair the table declares', () => {
    const used = new Set<string>();
    for (const name of STACK_PRESETS) {
      const p = byName(name).params;
      used.add(`${p['filter.model'] ?? 0}/${p['filter.type'] ?? 0}`);
      if ((p['filter.routing'] ?? 0) !== 0) used.add(`${p['filter2.model'] ?? 0}/${p['filter2.type'] ?? 1}`);
    }
    const missing = FILTER_MODES.flatMap((m, mi) =>
      m.taps.map((t, ti) => (used.has(`${mi}/${ti}`) ? null : `${m.label} ${t}`)),
    ).filter(Boolean);
    expect(missing, 'no preset demonstrates these').toEqual([]);
  });

  it('covers every routing mode', () => {
    const used = new Set(STACK_PRESETS.map((n) => byName(n).params['filter.routing'] ?? 0));
    expect([...used].sort()).toEqual([0, 1, 2, 3]);
  });

  it('demonstrates both ends of Track', () => {
    const t = STACK_PRESETS.map((n) => byName(n).params['filter2.track']).filter((v) => v !== undefined) as number[];
    expect(Math.min(...t)).toBe(0);
    expect(Math.max(...t)).toBe(1);
  });

  it('demonstrates the duplicate case the two slots exist to allow', () => {
    // The SAME filter in both slots at different cutoffs, subtracted.
    const p = byName('PAD Phase Ghost').params;
    expect(p['filter.model']).toBe(p['filter2.model']);
    expect(p['filter.type']).toBe(p['filter2.type']);
    expect(p['filter.routing']).toBe(3);
    expect(p['filter.cutoff']).not.toBe(p['filter2.cutoff']);
  });

  it('demonstrates the ring modulator and PWM, which had no preset at all', () => {
    expect(byName('FX Metal Comb').params['ring.level']).toBeGreaterThan(0.5);
    expect(connectedTo('KEY Bell Ring', 'ring.level', 'adsr')).toBe(true);
    expect(byName('PAD PWM Breather').params['osc1.wave'], 'width only bites on a square').toBe(1);
    expect(connectedTo('PAD PWM Breather', 'osc1.pw', 'lfo')).toBe(true);
  });

  it('ships a modulator on Blend, from an LFO and from an ADSR', () => {
    expect(connectedTo('BASS Twin Growl', 'filter.blend', 'lfo')).toBe(true);
    expect(connectedTo('KEY Morph Two Ways', 'filter.blend', 'adsr')).toBe(true);
  });
```

where `connectedTo(name, paramId, kind)` checks the preset's `modulators` array
for an enabled modulator of that kind with a non-zero connection to that param.

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/presets/subtractive-filter-presets.test.ts`
Expected: FAIL — `preset "PAD Glass Air" is missing`.

- [ ] **Step 3: Write the presets**

Append them to the `presets` array in `public/presets/subtractive.json`. Every
preset is `{ name, gm, params, modulators? }`; copy the shape from `BASS Wobble
LFO`, which is already in the file and carries an LFO. The filter fields to set
per preset are in the table above (`filter.model`, `filter.type`,
`filter.routing`, `filter2.model`, `filter2.type`, `filter2.cutoff`,
`filter2.resonance`, `filter2.track`, `filter.blend`); everything else — the
oscillators, the envelopes, unison — is yours to voice, following the style of
the presets already in the pack for that category (a BASS is short and low, a PAD
is slow and wide).

Two constraints, both enforced by the existing suite:

- Every param id must exist in `SUB_PARAM_SPECS`, every value inside its declared
  range, and every discrete value an integer.
- The comb presets tune with `filter.cutoff`, which under COMB is the comb's
  tuning: `0.35` is roughly 250 Hz, `0.5` roughly 900 Hz. Pick tunings that sit
  near the notes the preset is for.

- [ ] **Step 4: Run the preset suites**

Run: `NO_COLOR=1 npx vitest run src/presets/`
Expected: PASS, including the existing schema, range, integer, audibility and
boundedness checks over all 102 presets.

Two failures are plausible, each with one honest fix:

- **`rms` under 0.01** on a highpass or comb preset: they are quiet by
  construction. RAISE that preset's `output.trim` (the per-preset gain-staging
  lever, capped at 4 by the schema test). Do NOT lower the floor.
- **`peak` over 4.0** on a DIFFERENCE or comb preset: subtracting two resonant
  filters lets their peaks add, and a comb at high feedback rings. LOWER the
  resonances in 0.05 steps or add `"output.trim": 0.8`. Do NOT raise `BLOW_UP`.

Report every preset you retuned and to what.

- [ ] **Step 5: Full suite and typecheck**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`

- [ ] **Step 6: Do NOT listen to them yourself**

The presets are judged by ear and the ear belongs to the user. Do not start a dev
server. Instead, write into your report one line per preset saying what it should
sound like, so the controller's listening pass has the acceptance criteria in
front of it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat(presets): seventeen subtractive presets that exercise the whole engine

Between them they touch every (mode, tap) pair the table declares, all
four routing modes and both ends of Track, and the test asserts that
coverage rather than trusting it: a pair nobody demonstrates fails the
suite.

The ones that carry the argument: PAD Phase Ghost puts the SAME filter in
both slots at different cutoffs and subtracts them, which is a phaser with
no phaser in the chain. BASS Twin Growl growls by opening and closing that
band with an LFO on Blend rather than on a cutoff. KEY Morph Two Ways
walks from a four-pole highpass to a clean bandpass across the note with
an ADSR on Blend. STRING Comb Pluck and PAD Clarinet Comb are the same
comb a sign apart, and they sound nothing alike.

Three of them cover what the engine already had and no preset ever
demonstrated: FX Metal Comb and KEY Bell Ring are the first presets to use
the ring modulator at all, and PAD PWM Breather the first to put an LFO on
osc1.pw.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## After the last task

Report to the user:

- The suite result (file count and test count).
- The renderer's code-line count.
- That the branch is `worktree-subtractive-ringmod`, holding the ring modulator
  and this work, and that **nothing has been merged**.

Then the controller — not a subagent — does the two checks no test can make: open
the real screen and confirm the FILTER row reads right and no Type button appears
that the chosen Mode cannot honestly do, and play the presets.

Do NOT merge to `main`, do NOT switch branch or worktree, and do NOT call
`ExitWorktree` while the user is still reviewing.
