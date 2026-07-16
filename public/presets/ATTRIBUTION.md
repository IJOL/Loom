# Subtractive presets — provenance

29 of the presets in [`subtractive.json`](subtractive.json) are **not** Loom's own
work. They are ported from **mpump**, a browser groovebox by gdamdam:

- Source: <https://github.com/gdamdam/mpump> (`mpump/server/src/data/soundPresets.ts`)
- Live: <https://mpump.live/>
- Copyright (C) 2024-2026 gdamdam
- Licence: **AGPL-3.0-or-later** — the same licence Loom is under, which is what
  makes including them here lawful. If you redistribute Loom, these carry the same
  obligations as the rest of the source.

Same author and licence as the [pattern library](../patterns/ATTRIBUTION.md).

mpump ships 33 synth + 26 bass presets (59). **29 are ported, 30 are not** — its
synth has oscillators and a filter Loom's Subtractive does not, and a preset that
needs a missing feature would be a name in a dropdown that doesn't deliver the
sound. The ported names are listed in
[`src/presets/subtractive-presets.test.ts`](../../src/presets/subtractive-presets.test.ts),
which fails if one is dropped or renamed.

## How a mpump preset maps onto Loom

mpump's engine is [`poly-synth.js`](https://github.com/gdamdam/mpump/blob/main/mpump/server/public/worklets/poly-synth.js);
Loom's is [`subtractive-renderer.ts`](../../src/audio-dsp/subtractive-renderer.ts).
Both were read to derive these — no value was eyeballed:

| mpump | Loom | Conversion |
|---|---|---|
| `cutoff` (Hz) | `filter.cutoff` (0..1) | `ln(hz/60) / ln(220)` — Loom's knob is `min(60·220^x, 18000)` Hz |
| `resonance` (Q, 0..20) | `filter.resonance` (0..1) | `(Q/20)^0.7` — mpump's **own** ladder normalisation (`ladderRes` in its worklet), not an invented curve |
| `filterEnvDepth` | `filter.envAmount` | mpump adds `depth·8000` Hz (**absolute**); Loom adds `envAmount · min(cutoffHz·7, 16000)` (**relative to cutoff**). So `envAmount = depth·8000 / min(hz·7, 16000)` |
| filter envelope | `filter.*` ADSR | mpump's is **decay-only** (instant attack, decays to zero, no sustain) → `attack 0.002, decay = filterDecay ?? ampDecay, sustain 0` |
| `subOsc` / `subLevel` | `sub.level` | exact: both are a sine one octave down |
| `unison: 2` + `unisonSpread` | `osc1.detune` / `osc2.detune` | exact: two detuned oscillators at `∓spread` cents |
| `unison: 3` | two oscillators at `∓spread` | **lossy** — the centre voice is gone |
| `oscType: pwm` | `osc1.wave: 1` + `osc1.pw` | same saw-minus-shifted-saw pulse; the width is **static** (see below) |
| `filterModel: mog` / `303` | `filter.cutoff` + `filter.drive` | **lossy** — 4-pole saturating ladder → Loom's 2-pole SVF; drive stands in for the saturation |
| `filterOn: false` | `filter.cutoff: 1` | 13.2 kHz 2-pole ≈ open |
| `detune` (unison 1) | `osc1.detune` | exact (cents) |
| `gain` | — | **not** carried. It is staged against mpump's own mix; Loom stages presets with `output.trim`, and every port measured inside the existing pack's range, so none needed one |
| `noteLength`, `lfo*` | — | sequencer/modulator state, not synth params — see below |

**Key tracking is 0 on every port, deliberately.** mpump's cutoff is absolute, so
its basses genuinely get duller as they climb. That is the patch, so it is kept —
it is not an oversight to "fix".

**A preset carries values, not modulators.** Loom's preset format is `{name, gm,
params}`; there is no slot for an LFO. Where mpump used a *subtle* LFO as a
sweetener (a 0.2–0.4 Hz cutoff drift on `PAD Dark Drone`, `PAD Dub Chord`,
`PAD Pulse`, `BASS Reese Deep`, `BASS Jungle`, `BASS Dub`) the port drops it and
keeps the patch. Where the LFO **was** the patch, the preset is dropped instead —
see below.

**"Pulse", never "PWM".** mpump's `pwm` oscillator sweeps its width with a built-in
0.4–1.2 Hz LFO. Loom's square is the identical pulse construction, but a preset
can only set a static width — so these are named `PAD Pulse`, `BASS Pulse`,
`LEAD Gritty Pulse`, not "PWM Pad". To get the real thing, put an LFO on `osc1.pw`
in the modulation panel: the param is continuous precisely so that it can be. (On
a short bass note the sweep barely moves anyway, so `BASS Pulse` loses little.)

## What was dropped, and why

**The engine can't do it (22).** Porting these would put a name in the dropdown
that doesn't deliver the sound:

| Dropped | Needs |
|---|---|
| Supersaw, Hoover, Hoover Bass | **unison** (5–7 voices). Two detuned oscillators are not a supersaw, and the name is the feature |
| Razor | a **bandpass** filter — Loom's SVF only exposes `.lp` |
| Ethereal | a **highpass** filter — same |
| Digital Bell, FM Bell, FM Metallic, Rhodes Keys, FM Bass | **FM** — Loom has a dedicated FM engine with its own presets |
| Sync Lead, Sync Sweep, Sync Bass | **hard sync** |
| Wavetable Pad, Organ, Vocal Pad | **wavetables** — Loom has a Wavetable engine |
| Wobble, Neuro | a **tempo-synced LFO** (1/8, 1/16 at depth 0.7–0.8) on cutoff. A preset can't carry a modulator, and a wobble without the wobble is just a bass |
| Shimmer, Cosmic | a **pitch LFO** (~10-cent vibrato). It is the shimmer |
| Default ×2 | Loom's `Init` already is this |

**Redundant — Loom already ships the same sound (8).** Not a capability problem;
shipping both would be two names for one patch:

| Dropped | Already in Loom as |
|---|---|
| 303 Acid | `BASS Acid 303` — near-identical (high res, deep env, drive 0.5) |
| Acid Bass | lands on top of the ported `LEAD Acid Squelch` (Q10/600 Hz vs Q12/800 Hz) |
| Square Lead | `LEAD Square` |
| Warm Pad | `PAD Warm` |
| Pluck Bass | `BASS Plucky` |
| String Pad | `STRINGS Ensemble` / `STRINGS Synth` / `PAD Detuned Strings` |
| Pluck Lead | near-duplicate of the ported `PLUCK EDM` |
| Trance Sub | an audible twin of the ported `BASS Deep Sub` on Loom: both are sine+sub, and its differentiator — a 300 Hz lowpass — does nothing to a sine whose fundamental is already below it |

## Renames

Ports follow Loom's existing `CATEGORY Name` convention (`Deep Sub` → `BASS Deep
Sub`, `EDM Pluck` → `PLUCK EDM`, …). Three renames are not cosmetic:

- `PWM Pad` → **`PAD Pulse`**, `Gritty PWM` → **`LEAD Gritty Pulse`**, `PWM Bass`
  → **`BASS Pulse`** — the width is static; see "Pulse, never PWM" above.
- `Reese` → **`BASS Reese Deep`** — Loom already has a *different* `BASS Reese`.
  mpump's is darker with a much deeper sub (0.7 vs 0.4) and a wider ±25¢ detune.
