---
name: scripts
description: "Skill for the Scripts area of tb303-synth. 6 symbols across 1 files."
---

# Scripts

6 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `scripts/`
- Understanding how readWavMono, rms, peak work
- Modifying scripts-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/wav-diff.ts` | readWavMono, rms, peak, l2, main (+1) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `readWavMono` | Function | `scripts/wav-diff.ts` | 11 |
| `rms` | Function | `scripts/wav-diff.ts` | 26 |
| `peak` | Function | `scripts/wav-diff.ts` | 32 |
| `l2` | Function | `scripts/wav-diff.ts` | 38 |
| `main` | Function | `scripts/wav-diff.ts` | 48 |
| `pad` | Function | `scripts/wav-diff.ts` | 74 |

## How to Explore

1. `gitnexus_context({name: "readWavMono"})` — see callers and callees
2. `gitnexus_query({query: "scripts"})` — find related execution flows
3. Read key files listed above for implementation details
