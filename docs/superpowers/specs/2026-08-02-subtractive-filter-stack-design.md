# Subtractive: Mode x Type without the lies, two filter blocks, one routing control

Date: 2026-08-02 (revised the same day — see the note under "The shape of the fix")
Status: approved; Tasks 1-2 of the first version are implemented and are being
revised by this one

## The problem

The Subtractive filter is two dropdowns, **Model** (DIG / MOG / 303) and **Type**
(LP / HP / BP / NOTCH), and the user picks a point in a 3x4 grid. Two of those
twelve points are lies: a ladder has no honest notch (its resonance feedback
fills the null, and on the diode model at res 0.7 the null inverts into a bump),
so `ladderTapFor` quietly hands back the LOWPASS. You choose NOTCH, you hear a
lowpass, and nothing tells you.

A grid also hides what the choice actually is. "MOG + LP" and "DIG + LP" are both
lowpasses, and the difference between them — 24 dB/oct against 12, ladder against
state-variable — is exactly what you are choosing between. The grid buries it in
a second dropdown.

And there is one filter. A fixed high-pass under a sweeping low-pass, or two
resonant peaks side by side, or a band carved by subtracting one lowpass from
another — none of it is reachable, however the two dropdowns are set.

## The shape of the fix

Three changes, one coherent surface:

1. **Mode and Type come back as two controls — but Type only offers what the
   chosen Mode can honestly do.** Three more circuits join Mode.
2. **A second filter block**, off by default.
3. **A routing control** — OFF, series, parallel, difference — plus a Blend knob
   that always means the same thing: how much of B.

> **Revised 2026-08-02, after the flat list was built and looked at.** The first
> version of this spec collapsed Model x Type into one ten-entry list. It was
> approved, implemented, and it was worse. The reason is in
> `core/select-control.ts:7-9`: a discrete control paints a **radio strip at four
> options or fewer** and falls back to a native `<select>` above that. Model (3)
> and Type (4) were two strips you read at a glance; the ten-entry list crossed
> the threshold and turned a visible choice into a dropdown you have to open.
> Worse, the list grows multiplicatively — the three circuits added below would
> have made it twenty-odd entries. Mode x Type is the right shape after all. What
> was wrong with the original was never the two controls; it was that the grid
> offered combinations that did not work. So: two controls, and **Type offers
> only the responses the current Mode actually has.**

## 1. Mode x Type, with Type filtered by Mode

Two discrete params, and one table that says which pairs exist.

```ts
// src/audio-dsp/filter-kinds.ts
export type FilterTap = 'lp' | 'hp' | 'bp' | 'notch' | 'comb';

export interface FilterMode {
  value: string;              // stable id for presets/saves
  label: string;              // what the Mode control shows
  /** The responses this circuit can honestly produce, in TAP_ORDER. It is the
   *  Type control's option list, and a pair outside it cannot be selected. */
  taps: FilterTap[];
}
export const FILTER_MODES: readonly FilterMode[] = [ /* the six below, in order */ ];
```

| # | `value` | Label | Slope | Honest taps |
|---|---------|-------|-------|-------------|
| 0 | `dig`  | `DIG`  | 12 dB/oct | LP, HP, BP, NOTCH |
| 1 | `mog`  | `MOG`  | 24 dB/oct | LP, HP, BP |
| 2 | `acid` | `303`  | 24 dB/oct | LP, HP, BP |
| 3 | `comb` | `COMB` | — | POS, NEG, FF |

`filter.model` is an index into that table. **`filter.type` is an index into the
chosen mode's own `taps`**, clamped into range — which is exactly what the grid
already does to every discrete param (`engine-param-grid.ts:94`).

That one decision removes a whole class of problem: an invalid pair cannot be
represented at all, so there is nothing to resolve, no fallback rule to test, and
no way for a hand-edited preset to name a filter that does not exist. It also
keeps every existing value meaning what it meant, because each mode's taps are
declared in the order the old `Type` control used: DIG is `LP, HP, BP, NOTCH`
(0..3, unchanged), the ladders are `LP, HP, BP` (0..2, unchanged), and COMB's
`POS, NEG, FF` reuses 0..2 in a mode nothing has ever been saved with.

The cost is honest and visible: switch from DIG+NOTCH to MOG and the selection
lands on BP, because MOG has no notch and index 3 clamps to 2. The strip shows
which button is lit, so you can see it happen. Defaults are `model = 0` (DIG) and
`type = 0` (LP): exactly today's sound.

**Labels are short because the Mode already said the circuit.** Type reads
`LP` / `HP` / `BP` / `NOTCH`, four characters instead of `LP 24 MOG`. Mode reads
`DIG` / `MOG` / `303` / `COMB`.

**No lying buttons. That is the acceptance criterion.** The Type control offers
exactly `FILTER_MODES[mode].taps` and nothing else. Choose MOG and the NOTCH
button is not there — not present-and-disabled, not present-and-quietly-giving-
you-a-lowpass: absent. The old grid's defect was never that it had two controls;
it was that it offered twelve combinations and only ten worked. `ladderTapFor` —
the function whose job was translating a type index into a ladder tap, and lying
on one of them — stays deleted.

Every mode has at least two taps, so the Type control is always a real choice.
Should a future mode ever have one, the Type control hides rather than painting a
single button: a one-option strip is a label pretending to be a choice, which is
the same lie in a smaller font.

**Both controls stay radio strips.** Four options is the strip's ceiling
(`select-control.ts:7-9`) and both land on it exactly: four modes, at most four
types. This is what the flat list cost us and what the revision buys back — the
filter choice is two rows of buttons you read at a glance, never a dropdown you
open.

**There is no impossible pair to resolve.** Because `type` indexes the mode's own
taps and is clamped, `tapFor(model, type) = FILTER_MODES[model].taps[clamp(type)]`
always names a tap that mode really has. A hand-edited preset with
`filter.type: 9` under MOG lands on BP, the last one it has — not on a lie.

## 1b. COMB, the one new circuit

A short delay summed back on itself. The delayed copy reinforces the frequencies
whose period fits the delay and cancels the ones that fall between, so the
response is a whole series of evenly spaced peaks rather than one corner — which
is the thing none of the three existing circuits can do, because all three shape
a single corner.

**Its three taps are three genuinely different responses**, not variants of one:

| Tap | Formula | Peaks land on | Sounds like |
|-----|---------|---------------|-------------|
| `POS` | `y = x + g·y[n−D]` | every harmonic of the tuning | a plucked string |
| `NEG` | `y = x − g·y[n−D]` | ODD harmonics only | hollow, a stopped pipe or a clarinet |
| `FF`  | `y = x + g·x[n−D]` | (notches, no ringing) | a flanger frozen mid-sweep |

POS and NEG differ by a sign and sound nothing alike: cancelling the even
harmonics is what makes a clarinet a clarinet. FF has no feedback path at all,
so it colours without ringing — the gentle one. Each is measurable by where its
peaks and notches actually fall, which is how their tests are written.

Two knobs are reinterpreted under COMB, and the manual says both out loud:

- **`Cutoff` becomes the comb's TUNING.** The delay is `sr / f`, so the knob
  picks the frequency the peaks are spaced by, not a corner. Loom already does
  this elsewhere: the Sync wave reads the PW knob as its ratio
  (`subtractive-params.ts`). Reinterpreting a knob is honest when it is stated
  and silent when it is not.
- **`Resonance` becomes the feedback `g`.** More feedback, longer ringing,
  sharper peaks. Clamped strictly under 1 — at 1 the loop never decays. Under
  FF it sets how deep the notches cut, and cannot ring at all.

The delay line is allocated at trigger, sized for the lowest tuning the knob
reaches. It is a per-voice buffer and poly lanes are uncapped by design, so the
lowest tuning is capped in the DSP rather than left to the knob (a 20 Hz comb at
48 kHz is 2400 samples per voice).

**COMB is not fused into any other mode, and does not need to be.** "A comb
added to DIG" is Filter A = DIG, Filter B = COMB, Routing = Parallel — which IS
a sum. The two-block design already composes them, in four ways rather than one:
series (filter first, then comb the remainder), parallel (the filtered body plus
the metallic peaks on top), difference (the sound minus exactly what the comb
reinforces), and any of the three dosed by Blend or breathed by an LFO on it.
Fusing the comb into DIG would be a special case that duplicates the general
mechanism. Filter B's Track knob earns its keep here too: at 0 the comb stays
tuned where you put it while the DIG sweeps; at 1 its tuning follows the sweep,
keeping the interval.

Two circuits were considered and dropped: a clean 24 dB/oct cascade of two
`Svf`, and a Sallen-Key MS-20 whose feedback saturates. Both are worth having;
neither is in this round. Adding one later is a row in the table plus its
measured taps — which is what the table is for.

**The ladders' HP and BP are real, and this is why duplicates are honest.** A
ladder is four one-pole lowpasses in a feedback loop, so its stage outputs are
LP1..LP4 and the other responses expand binomially out of them: `(1-LP)^4` is a
4-pole highpass, `LP^2(1-LP)^2` a 2-pole bandpass — the same derivation the
Oberheim Xpander uses. Both null at DC by construction. They are not the lowpass
relabelled, and `subtractive-renderer.test.ts` already asserts it for MOG and 303.

## 2. `FilterStack` — the two blocks and the routing

A new module, `src/audio-dsp/filter-stack.ts`, owns everything about filtering:
the kind table, building a concrete filter from a kind, both blocks, and the
routing between them.

```ts
export class FilterStack {
  constructor(kindA: number, kindB: number, routing: number, sr: number);
  update(x: number, cutA: number, resA: number,
         cutB: number, resB: number, blend: number): number;
}
```

Routing is four discrete modes:

| # | `value` | Behaviour |
|---|---------|-----------|
| 0 | `off` | `out = A(x)` — B is never built, never runs |
| 1 | `ser` | `a = A(x); out = a + blend * (B(a) - a)` |
| 2 | `par` | `a = A(x); out = a + blend * (B(x) - a)` |
| 3 | `diff` | `out = A(x) - blend * B(x)` |

`blend` is how much of B is in the result, in every mode. At 0 all three modes
equal OFF; at 1, SER is the full chain, PAR is B alone, DIFF is the whole
subtraction. One meaning, no mode-dependent reinterpretation — and it is
continuous, so an LFO on it moves the routing itself.

SER and PAR are lerps, so neither adds level. DIFF can reach the sum of two
filtered copies; it is the one mode whose boundedness has to be measured rather
than argued (see Testing).

**Why DIFF earns its place.** It is what makes two identical lowpasses useful: A
at 2 kHz minus B at 200 Hz IS a band-pass between those cutoffs, with the two
edges' resonance set independently — a response no single entry in the list can
produce.

## 3. Filter B's cutoff, and TRACK

Filter A keeps today's cutoff exactly: `base + keyTrack + env * envRange`.

Everything that MOVES A — the filter envelope and key tracking — is summarised as
one ratio against A's own base, and B follows it in the proportion `track` says:

```
aRatio  = cutoffA_final / cutoffA_base
cutoffB = baseB * (1 + track * (aRatio - 1))
```

- `track = 0` — B is nailed where its knob puts it. This is the fixed high-pass
  under a sweeping low-pass.
- `track = 1` — `cutoffB = baseB * aRatio`, so the interval between A and B in
  OCTAVES is preserved as both sweep. Two formants moving as a block.
- In between, B follows part of the way.

Multiplicative on purpose: an additive follow in Hz would collapse the octave
relationship the moment the envelope opened. One division and two multiplies per
sample — no `pow`, no `log`.

## 4. Params and UI

The FILTER row becomes two sections.

**FILTER A** (`var(--knob-orange)`, unchanged): Mode, Type, Cutoff, Res, Env Amt,
Drive, Key Track.

**FILTER B** (`var(--knob-teal)`): Routing, Mode, Type, Cutoff, Res, Track, Blend.
Routing lives here because Routing = OFF is what makes this whole section inert;
the control and the thing it switches off read as one block.

| id | kind | range | default | read |
|----|------|-------|---------|------|
| `filter.model`      | discrete | 0..3 | 0 (`DIG`) | trigger |
| `filter.type`       | discrete | 0..3 | 0 (`LP`)  | trigger |
| `filter.routing`    | discrete | 0..3 | 0 (`OFF`) | trigger |
| `filter2.model`     | discrete | 0..3 | 0 (`DIG`) | trigger |
| `filter2.type`      | discrete | 0..3 | 1 (`HP`)  | trigger |
| `filter2.cutoff`    | continuous | 0..1 | 0.25 | live |
| `filter2.resonance` | continuous | 0..1 | 0.2  | live |
| `filter2.track`     | continuous | 0..1 | 0    | live |
| `filter.blend`      | continuous | 0..1 | 1    | live |

**The ids stay `filter.model` and `filter.type`** — the two the engine has always
had, with index 0..2 of the model table still DIG / MOG / 303. That is not
nostalgia: it means the six preset values that name the filter keep the numbers
they already have, and a user's old save still loads to the sound it stored. The
label on the control reads **Mode** (it selects a circuit, and "model" means an
engine elsewhere in this codebase), but the stored id does not churn for a word.

What changed is that `type`'s option list is now derived from `model` instead of
being a fixed four, and that its index space grew to hold the comb's three
responses.

Trigger-time for the five discretes, for the reason the filter model has always
been: a topology is not something you sweep mid-note. The four continuous ones
are read every sample from the lane's live bag, so the knob moves the note
already sounding, and they become modulation destinations for free — declaring
them is all it takes (`buildParamIndex` numbers them, `DestinationRegistry` lists
them).

`filter.routing` defaults to OFF, so a lane that says nothing about filter B is
bit-identical to today.

## 5. Where the code goes

`subtractive-renderer.ts` is at 321 code lines against a 300 target. Adding two
filters and four routing modes inline would push it near 400.

So `filter-stack.ts` takes them, and the renderer gets SMALLER: `ladderTapFor`,
`filterAt`, the `Svf`/`LadderFilter` construction and the `filterType` field all
move out. What is left is one `FilterStack` field and one `stack.update(...)`
call. The new module is a closed unit — hand it a sample and six numbers, get a
sample back; it knows nothing about notes, envelopes or params.

## 6. What else moves in the same change

- **`public/presets/subtractive.json`** — 6 values across the 85 presets name
  the filter (4x `filter.model: 1`, one `filter.type: 1`, one `filter.type: 2`).
  With `mode`/`type` restored under their original ids and index 0..2 of the mode
  table unchanged (DIG, MOG, 303), **all six keep the value they always had** and
  nothing in the preset pack needs converting at all. No preset uses a
  NOTCH+ladder pair, so nothing changes what it sounds like.
- **`poly-preset-store.ts`** — nothing. It flattens the legacy PolySynth tree
  into dot-ids and never emitted `filter.model` or `filter.type` in the first
  place (verified 2026-08-02), so the filter simply is not in its output.
- **`SubParams` + `defaultSubParams()`** — `filterModel` and `filterType` come
  back under their original names (Task 2 of the first version had collapsed them
  into `filterKind`), plus the new `filter2*` / `routing` / `blend` fields.
- **`docs/manual/04-engines.md`** — its "only DIG is a true multimode; with MOG
  or 303 the Type dropdown has no effect" is ALREADY false (the ladders have had
  honest HP and BP taps since the multimode work). Rewritten around Mode x Type
  with the per-mode tap tables, the comb's three responses and its two
  reinterpreted knobs, plus a section on the two blocks and the routing.

Old saves keep working for the three original circuits, since their
`filter.model` / `filter.type` values still mean what they meant. A save that
somehow carries a
pair the table does not have resolves through `resolveTap` — deterministically,
to that mode's first tap. That is not a migration; it is the same resolution the
live UI is built on.

## 7. Presets — sixteen, and the coverage is asserted

A feature nobody can hear is not shipped, and "the presets cover it" is a claim
worth asserting rather than believing. Sixteen new presets touch **every declared
(mode, tap) pair, all four routing modes and both ends of Track** between them,
and the test fails if a pair nobody demonstrates creeps in — including the comb's
three responses.

The set is listed in full in the implementation plan. Three of them carry the
argument:

- **`PAD Phase Ghost`** puts the SAME filter — DIG + LP — in both slots at
  different cutoffs and subtracts them. It is the answer to "why would I want the
  same filter twice": the moving band between them is a phaser with no phaser in
  the chain.
- **`BASS Twin Growl`** growls by opening and closing that band with an LFO on
  Blend, rather than by wobbling a cutoff.
- **`KEY Morph Two Ways`** walks from a four-pole highpass to a clean bandpass
  across the note, with an ADSR on Blend.

Three more cover what the engine already had and no preset ever demonstrated:
`FX Metal Comb` and `KEY Bell Ring` are the first presets to use the **ring
modulator** at all, and `PAD PWM Breather` is the first to put an LFO on
`osc1.pw` — the thing `ATTRIBUTION.md` has been telling readers to do by hand
ever since the pulse width was exposed.

## Testing

Vitest, in `src/audio-dsp/filter-stack.test.ts` (the stack) and
`subtractive-renderer.test.ts` (the engine end of it). All assertions relative,
as the suite requires. One test per user path, no `(or ...)` alternatives.

**Mode x Type**

1. Every declared (mode, tap) pair builds the circuit and response it promises —
   walk `FILTER_MODES` and its `taps`.
2. **No declared pair is a silent alias of another.** Render the same patch
   through every pair and compare each with the file's existing `divergence`
   helper (mean absolute difference over the render's own RMS): every pair must
   exceed the threshold the suite already uses to call two sounds different
   (0.01 — what `leaves a saw alone` asserts a NON-difference under). This is
   the "no lying buttons" requirement as an assertion, and it is the test that
   would have caught NOTCH-on-a-ladder returning the lowpass.
2b. **The Type control offers exactly the declared taps.** For each mode, the
   option list the UI builds equals `FILTER_MODES[mode].taps` — no extra button,
   no missing one. A button that cannot be honest must not be paintable, and
   this is the test that says so.
2c. `tapFor(model, type)` always names a tap the mode declares, for every model
   and every integer type including out-of-range ones — the property that makes
   an invalid pair unrepresentable rather than merely unreachable.
3. A lowpass entry passes what is under the cutoff and stops what is over it; a
   highpass does the mirror; a bandpass rejects both sides; the notch nulls. Per
   entry, not per family — that is how a mislabelled row gets caught.

**The routing**

4. Routing OFF is bit-identical to a single-filter render.
5. Blend 0 equals OFF, in SER, PAR and DIFF alike.
6. SER removes more than A alone (two lowpasses in series).
7. PAR of a closed lowpass (A) and an open one (B) passes more than A alone —
   the parallel path is a sum, so the open branch's content is there.
8. DIFF with two lowpasses has more energy BETWEEN the two cutoffs than outside
   them — it is a band-pass, which is the claim the mode is here to make.
9. Every mode stays bounded at maximum drive and resonance.

**Track**

10. Track 0 leaves B's cutoff still while A's envelope sweeps.
11. Track 1 keeps B's cutoff at a constant RATIO to A's as both sweep.

**The presets**

15. All sixteen exist, and each is audible against the same silence floor the
    rest of the pack is held to.
16. Between them they cover every entry in the list, every routing mode, and
    Track at both 0 and 1 — asserted, so a kind nobody demonstrates fails.
17. The presets that ship a modulator on Blend actually move when it moves.

**Regression, already in the suite and expected to stay green**

12. `declared-params.dsp.test.ts` — every id the renderer reads live is declared.
13. `live-params.dsp.test.ts` — the four new continuous params move a sounding note.
14. `subtractive-presets.test.ts` and friends — the 85 presets still render.

## Deliberately not in scope

- **A third filter block.** Two covers series, parallel and difference; a third
  turns the routing dropdown into a matrix and multiplies per-voice cost under a
  polyphony that is uncapped by design.
- **Per-block drive.** Drive stays where it is, pre-filter and global.
- **A second filter envelope.** Track is the answer to "how does B move", and it
  costs one knob instead of four.
- **Filter A OFF.** A is always in the path, as today. A wide-open `LP 12 DIG` at
  cutoff 1 is the bypass.
