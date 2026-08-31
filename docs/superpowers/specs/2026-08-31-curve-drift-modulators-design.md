# Curve & Drift Modulators — Design

**Date:** 2026-08-31 · **Status:** approved in chat, pending spec review
**Origin:** The Synth Mines ranking, items 7 ("one curve editor, paid for three
times") and 4 ("drift modulator"). Reinforced by the Reason Free research:
Europa's drawable envelopes are a signature of why its patches sound alive.

## Goal

Two new modulator plugins plus one new host control:

1. A **point/segment curve editor** in the host control catalogue
   (`Loom.controls.curve`), built once, designed for three consumers — of which
   this round wires ONE (the curve modulator). Mod-remap curves and automation
   editing are later rounds on the same control.
2. Plugin **`curve`**: two modulator components sharing one editor and one
   evaluator — **Curve LFO** (cyclic) and **Curve Env** (per-note MSEG-style
   envelope).
3. Plugin **`drift`**: smoothed-random / chaotic motion (the analog-life
   modulator), no custom UI.

## Non-goals (this round)

- Per-connection mod-remap curves and bipolar polarity (next round, same control).
- Automation-lane editing with the curve control (later round).
- Beat-sync for Curve LFO — a `driver:'time'` kernel receives no bpm today
  (`ModLiteLike` carries none); plumbing bpm into kernels is its own decision.
  Rate is free Hz in v1, matching the stepseq precedent.
- Extending the `driver:'gate'` road. Verified: gate NEVER reaches a plugin
  kernel by design (SDK types.ts §ModEnvSpec; design doc §3.3) — that road is
  ModEnvHost's fixed ADSR shape. Curve Env deliberately does NOT touch it.

## 1 · The curve control — `Loom.controls.curve`

Lives beside `knob` and `steps` in the host control catalogue, same contract:
pure DOM + pointer events (a plugin's compiled main.js cannot import our
bundled lit-html), **mounted once and kept alive across repaints** — the
stepseq/WEAVE lesson: never destroy the element a pointer is holding.

API:

```ts
Loom.controls.curve({
  points: CurvePoint[],            // initial state
  onChange: (points: CurvePoint[]) => void,
  label: string,                   // a11y
  grid?: { x: number; y: number }, // snap divisions; omit = no snap
}) => { el: HTMLElement; set(points: CurvePoint[]): void }
```

`CurvePoint = { x: 0..1, y: 0..1, c: -1..+1 }` — `c` is the curvature of the
segment leaving this point toward the next (0 = linear, negative = ease-out,
positive = ease-in; evaluated with the same shaping function the DSP uses, so
what you draw is what plays). Interaction: drag to move (endpoints locked to
x=0 / x=1 in x), double-click empty space to add a point (up to 16),
double-click a point to remove it (min 2), drag vertically on a segment's
midpoint handle to bend `c`. Rendering: one SVG painted from CSS variables so
both themes work. `set()` repaints from outside (undo, preset) without
rebuilding the element.

File: `src/core/curve-control.ts` (+ registration wherever `knob`/`steps`
enter the plugin-facing catalogue — follow the existing wiring, single door).

## 2 · Plugin `curve` — two components, one editor

**Storage** is the modulator's numeric bag (`ModulatorConfigApi`, numbers
only): `pts` (count), then `p{i}x`, `p{i}y`, `p{i}c` per point. First-mount
seed, sentinel-guarded exactly like the stepseq (`p0x` absent → seed): a
descending ramp `(0,1) → (1,0)` with slight ease — audible from the first
connection, and a deliberately different silhouette from the stepseq's seed.

**Curve LFO** — component `curve-lfo`, `driver:'time'`, scopes
`['shared','per-voice']` (first = default, per the registry's convention;
`ModulatorScope` has exactly those two values — the free/note/voice trio is
the phase-ORIGIN axis the runtime resolves, not the scope):

- Params: `rate` Hz (0.05–32, log feel via knob), `bipolar` (0/1).
- Kernel: `phase = frac((t − origin) · rate)`; value = `evalCurve(points, phase)`,
  mapped to −1..+1 when bipolar.

**Curve Env** — component `curve-env`, `driver:'time'`, scopes
`['per-voice']` ONLY. Per-note is the point; a shared curve-env would be the
LFO wearing a different name. The runtime hands a voice-scoped kernel its voice's start as
`origin`, which is what makes a time kernel a per-note envelope without
touching the gate road:

- Params: `duration` seconds (0.02–20, log), `mode` (0 = one-shot: clamp at
  the final point's y after `duration`; 1 = loop: wrap while the voice sounds).
- Kernel: `pos = (t − origin) / duration`; one-shot clamps `pos` to 1, loop
  takes `frac(pos)`.

**Shared DSP**: one `evalCurve(points, x)` in `plugins/curve/dsp.ts`, used by
both kernels; piecewise between points with the `c` shaping curve. Stays in
the plugin (SDK admission rule: an SDK primitive must fit ANY engine — if a
second plugin wants this later, promote it then).

**Editor**: `plugins/curve/main.ts` registers ONE `configMount` per component
(both mount the same control + their own knobs — rate/bipolar vs
duration/mode), all built from `Loom.controls`.

## 3 · Plugin `drift`

No custom UI — the generic param grid renders its params. Component `drift`,
`driver:'time'`, scopes `['shared','per-voice']`.

- Params: `rate` Hz (0.05–16), `amount` (0–1), `mode` (0 = **drift**: value
  noise — random targets at `rate`, smoothstep interpolation between them,
  Perlin-flavoured wandering; 1 = **chaos**: a Lorenz step normalised into
  −1..+1, continuous unpredictable swoops).
- Deterministic per instance: seeded from the modulator instance id hash, per
  the kernel contract (same run, same sound; different instances, different
  paths).

## 4 · Tests

- **Control** (jsdom, `src/core/curve-control.test.ts`): add/drag/remove
  points, endpoint x-lock, snap honoured when `grid` given, `set()` repaints,
  and "the same element survives a repaint".
- **Kernels** (pure, `plugins/curve/dsp.test.ts`, `plugins/drift/dsp.test.ts`):
  evalCurve at known phases (linear + curved), one-shot clamps to the final y,
  loop wraps, bipolar maps range; drift stays in −1..+1, is continuous
  (adjacent-sample delta bounded relative to rate), and two seeds diverge.
  Relative assertions per the repo convention.
- **Pipeline**: check whether `modulation-pipeline.test.ts` walks registered
  modulators or a fixed list; if fixed, add curve-lfo + drift rows so the
  end-to-end "the render changes" coverage includes them.
- **Live look**: mount the curve editor in the running app, draw, hear it move
  a param (mandatory browser look for UI done-claims).

## 5 · Files

| File | Role |
| --- | --- |
| `src/core/curve-control.ts` | the control (+ catalogue registration) |
| `src/core/curve-control.test.ts` | control tests |
| `plugins/curve/plugin.json` | manifest: two modulator components |
| `plugins/curve/dsp.ts` | evalCurve + both kernels |
| `plugins/curve/main.ts` | both configMounts |
| `plugins/curve/dsp.test.ts` | kernel tests |
| `plugins/drift/plugin.json` | manifest |
| `plugins/drift/dsp.ts` | drift/chaos kernel |
| `plugins/drift/dsp.test.ts` | kernel tests |

All under 300 code lines each. `npm run build:plugins` after every plugin
edit — `public/plugins/` is what the app loads.

## Risks & verifications done

- **Gate road untouched** — verified in SDK `types.ts`: `driver:'gate'` never
  reaches a plugin kernel; voice-scoped `time` + origin covers the per-note
  need. No ABI change anywhere in this round.
- **`Loom.controls` is plugin ABI** — adding `curve` is additive; existing
  plugins unaffected.
- **Numeric bag capacity** — 16 points × 3 + count = 49 keys; the bag is a
  plain Record, no limit concern.
- **Kernel determinism** — drift must not call `Math.random` at render time
  (the Karplus lesson); seed once from the instance id.

## Follow-ups this design deliberately leaves out

Mod-remap curves per connection (+ per-connection bipolar), automation editing
on the same control, beat-sync rates for plugin kernels (needs bpm in the
kernel input), promoting `evalCurve` to the SDK if a second consumer appears.
