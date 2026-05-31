---
name: automation
description: "Skill for the Automation area of tb303-synth. 32 symbols across 7 files."
---

# Automation

32 symbols | 7 files | Cohesion: 83%

## When to Use

- Working with code in `src/`
- Understanding how clamp01, formatNum, ensureLaneSize work
- Modifying automation-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/automation/automation-painter.ts` | clamp01, formatNum, ensureLaneSize, snapLaneToSteps, attachLanePainter (+5) |
| `src/automation/automation-ui.ts` | removeLane, renderLanes, draw, redrawAllLanes, populateAutoParamSelect (+3) |
| `src/session/clip-automation-lanes.ts` | asPainterLane, renderClipAutomationLanes, buildParamSelect, buildBrushBar, mk (+1) |
| `src/automation/automation-tick.ts` | applyModulationToKnobs, tick, resetAutomationPosition |
| `src/core/sequencer.ts` | isPlaying, start |
| `src/main.ts` | launchSceneById, launchScene |
| `src/session/session-runtime.ts` | tickSessionEnvelopes |

## Entry Points

Start here when exploring this area:

- **`clamp01`** (Function) — `src/automation/automation-painter.ts:11`
- **`formatNum`** (Function) — `src/automation/automation-painter.ts:13`
- **`ensureLaneSize`** (Function) — `src/automation/automation-painter.ts:21`
- **`snapLaneToSteps`** (Function) — `src/automation/automation-painter.ts:47`
- **`attachLanePainter`** (Function) — `src/automation/automation-painter.ts:117`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `clamp01` | Function | `src/automation/automation-painter.ts` | 11 |
| `formatNum` | Function | `src/automation/automation-painter.ts` | 13 |
| `ensureLaneSize` | Function | `src/automation/automation-painter.ts` | 21 |
| `snapLaneToSteps` | Function | `src/automation/automation-painter.ts` | 47 |
| `attachLanePainter` | Function | `src/automation/automation-painter.ts` | 117 |
| `pointerToSubVal` | Function | `src/automation/automation-painter.ts` | 127 |
| `paint` | Function | `src/automation/automation-painter.ts` | 136 |
| `tick` | Function | `src/automation/automation-tick.ts` | 73 |
| `renderLanes` | Function | `src/automation/automation-ui.ts` | 83 |
| `renderClipAutomationLanes` | Function | `src/session/clip-automation-lanes.ts` | 42 |
| `tickSessionEnvelopes` | Function | `src/session/session-runtime.ts` | 250 |
| `drawLane` | Function | `src/automation/automation-painter.ts` | 61 |
| `xFor` | Function | `src/automation/automation-painter.ts` | 85 |
| `yFor` | Function | `src/automation/automation-painter.ts` | 86 |
| `draw` | Function | `src/automation/automation-ui.ts` | 164 |
| `redrawAllLanes` | Function | `src/automation/automation-ui.ts` | 171 |
| `draw` | Function | `src/session/clip-automation-lanes.ts` | 166 |
| `resetAutomationPosition` | Function | `src/automation/automation-tick.ts` | 58 |
| `populateAutoParamSelect` | Function | `src/automation/automation-ui.ts` | 32 |
| `addLane` | Function | `src/automation/automation-ui.ts` | 66 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `LaunchSceneById → BuildGhost` | cross_community | 7 |
| `OpenInspector → BuildParamSelect` | cross_community | 6 |
| `WireAutomationTab → XFor` | cross_community | 6 |
| `WireAutomationTab → YFor` | cross_community | 6 |
| `LaunchSceneById → IsFileDrag` | cross_community | 6 |
| `OpenInspector → Mk` | cross_community | 5 |
| `LaunchSceneById → Spacer` | cross_community | 5 |
| `LaunchSceneById → LaneHeader` | cross_community | 5 |
| `LaunchSceneById → ScenesHeader` | cross_community | 5 |
| `LaunchSceneById → ListEngines` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Session | 2 calls |
| Engines | 1 calls |

## How to Explore

1. `gitnexus_context({name: "clamp01"})` — see callers and callees
2. `gitnexus_query({query: "automation"})` — find related execution flows
3. Read key files listed above for implementation details
