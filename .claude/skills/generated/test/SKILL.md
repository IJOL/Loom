---
name: test
description: "Skill for the Test area of tb303-synth. 9 symbols across 4 files."
---

# Test

9 symbols | 4 files | Cohesion: 95%

## When to Use

- Working with code in `test/`
- Understanding how rms, peak, isSilent work
- Modifying test-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `test/dsp-asserts.ts` | rms, peak, isSilent, spectralCentroid, fftRadix2 |
| `test/wav.ts` | wavPath, writeWav |
| `src/engines/wavetable-overlap.dsp.test.ts` | rmsWindow |
| `test/dsp-battery.ts` | runStandardEngineBattery |

## Entry Points

Start here when exploring this area:

- **`rms`** (Function) — `test/dsp-asserts.ts:4`
- **`peak`** (Function) — `test/dsp-asserts.ts:10`
- **`isSilent`** (Function) — `test/dsp-asserts.ts:19`
- **`spectralCentroid`** (Function) — `test/dsp-asserts.ts:28`
- **`runStandardEngineBattery`** (Function) — `test/dsp-battery.ts:59`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `rms` | Function | `test/dsp-asserts.ts` | 4 |
| `peak` | Function | `test/dsp-asserts.ts` | 10 |
| `isSilent` | Function | `test/dsp-asserts.ts` | 19 |
| `spectralCentroid` | Function | `test/dsp-asserts.ts` | 28 |
| `runStandardEngineBattery` | Function | `test/dsp-battery.ts` | 59 |
| `wavPath` | Function | `test/wav.ts` | 9 |
| `writeWav` | Function | `test/wav.ts` | 13 |
| `rmsWindow` | Function | `src/engines/wavetable-overlap.dsp.test.ts` | 52 |
| `fftRadix2` | Function | `test/dsp-asserts.ts` | 95 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Engines | 1 calls |

## How to Explore

1. `gitnexus_context({name: "rms"})` — see callers and callees
2. `gitnexus_query({query: "test"})` — find related execution flows
3. Read key files listed above for implementation details
