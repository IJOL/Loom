---
name: performance
description: "Skill for the Performance area of tb303-synth. 31 symbols across 6 files."
---

# Performance

31 symbols | 6 files | Cohesion: 82%

## When to Use

- Working with code in `src/`
- Understanding how onLookahead, rafPlayhead, sampleAutomationAt work
- Modifying performance-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/performance/arrangement-ops.ts` | sampleAutomationAt, getOrCreateLane, appendClipEvent, routeParamId, getOrCreateCurve (+2) |
| `src/performance/rec-state.ts` | tickRecAutomation, createRecState, armRec, markParamTouched, disarmRec (+1) |
| `src/app/performance-feature.ts` | onLookahead, rafPlayhead, createPerformanceFeature, flashToast, onPlay |
| `src/performance/arrangement-runtime.ts` | isLaneOverridden, arrangementPlayhead, tickArrangement, createArrangementPlayState, startArrangement |
| `src/performance/performance-ui.ts` | makeLabel, makeRuler, makeClipBand, makeAutomationBand, renderPerformanceView |
| `src/performance/performance.ts` | stepsPerSec, emptyLaneRec, emptyArrangementState |

## Entry Points

Start here when exploring this area:

- **`onLookahead`** (Function) — `src/app/performance-feature.ts:151`
- **`rafPlayhead`** (Function) — `src/app/performance-feature.ts:201`
- **`sampleAutomationAt`** (Function) — `src/performance/arrangement-ops.ts:79`
- **`isLaneOverridden`** (Function) — `src/performance/arrangement-runtime.ts:40`
- **`arrangementPlayhead`** (Function) — `src/performance/arrangement-runtime.ts:44`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `onLookahead` | Function | `src/app/performance-feature.ts` | 151 |
| `rafPlayhead` | Function | `src/app/performance-feature.ts` | 201 |
| `sampleAutomationAt` | Function | `src/performance/arrangement-ops.ts` | 79 |
| `isLaneOverridden` | Function | `src/performance/arrangement-runtime.ts` | 40 |
| `arrangementPlayhead` | Function | `src/performance/arrangement-runtime.ts` | 44 |
| `tickArrangement` | Function | `src/performance/arrangement-runtime.ts` | 60 |
| `stepsPerSec` | Function | `src/performance/performance.ts` | 40 |
| `tickRecAutomation` | Function | `src/performance/rec-state.ts` | 51 |
| `getOrCreateLane` | Function | `src/performance/arrangement-ops.ts` | 4 |
| `appendClipEvent` | Function | `src/performance/arrangement-ops.ts` | 13 |
| `routeParamId` | Function | `src/performance/arrangement-ops.ts` | 36 |
| `writeAutomationSample` | Function | `src/performance/arrangement-ops.ts` | 63 |
| `emptyLaneRec` | Function | `src/performance/performance.ts` | 34 |
| `createPerformanceFeature` | Function | `src/app/performance-feature.ts` | 56 |
| `createArrangementPlayState` | Function | `src/performance/arrangement-runtime.ts` | 12 |
| `emptyArrangementState` | Function | `src/performance/performance.ts` | 30 |
| `createRecState` | Function | `src/performance/rec-state.ts` | 13 |
| `armRec` | Function | `src/performance/rec-state.ts` | 17 |
| `markParamTouched` | Function | `src/performance/rec-state.ts` | 36 |
| `flashToast` | Function | `src/app/performance-feature.ts` | 82 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnGoToSession → MakeLabel` | cross_community | 6 |
| `OnGoToSession → StepsPerSec` | cross_community | 6 |
| `OnLookahead → EmptyLaneRec` | cross_community | 5 |
| `OnLookahead → RouteParamId` | cross_community | 4 |
| `OnLookahead → GetOrCreateCurve` | cross_community | 4 |
| `OnLookahead → HoldExtend` | cross_community | 4 |
| `OnLookahead → ArrangementNow` | cross_community | 3 |
| `OnLookahead → StepsPerSec` | intra_community | 3 |
| `OnLookahead → ArrangementPlayhead` | intra_community | 3 |
| `OnLookahead → IsLaneOverridden` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| App | 2 calls |
| Session | 1 calls |

## How to Explore

1. `gitnexus_context({name: "onLookahead"})` — see callers and callees
2. `gitnexus_query({query: "performance"})` — find related execution flows
3. Read key files listed above for implementation details
