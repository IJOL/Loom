<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **tb303-synth** (6993 symbols, 15306 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/tb303-synth/context` | Codebase overview, check index freshness |
| `gitnexus://repo/tb303-synth/clusters` | All functional areas |
| `gitnexus://repo/tb303-synth/processes` | All execution flows |
| `gitnexus://repo/tb303-synth/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Engines area (361 symbols) | `.claude/skills/generated/engines/SKILL.md` |
| Work in the App area (118 symbols) | `.claude/skills/generated/app/SKILL.md` |
| Work in the Session area (116 symbols) | `.claude/skills/generated/session/SKILL.md` |
| Work in the Modulation area (65 symbols) | `.claude/skills/generated/modulation/SKILL.md` |
| Work in the Polysynth area (45 symbols) | `.claude/skills/generated/polysynth/SKILL.md` |
| Work in the Save area (33 symbols) | `.claude/skills/generated/save/SKILL.md` |
| Work in the Automation area (32 symbols) | `.claude/skills/generated/automation/SKILL.md` |
| Work in the Performance area (31 symbols) | `.claude/skills/generated/performance/SKILL.md` |
| Work in the Plugins area (27 symbols) | `.claude/skills/generated/plugins/SKILL.md` |
| Work in the Clip-editors area (24 symbols) | `.claude/skills/generated/clip-editors/SKILL.md` |
| Work in the Midi area (23 symbols) | `.claude/skills/generated/midi/SKILL.md` |
| Work in the Arp area (22 symbols) | `.claude/skills/generated/arp/SKILL.md` |
| Work in the Copy area (21 symbols) | `.claude/skills/generated/copy/SKILL.md` |
| Work in the Fx area (19 symbols) | `.claude/skills/generated/fx/SKILL.md` |
| Work in the Samples area (17 symbols) | `.claude/skills/generated/samples/SKILL.md` |
| Work in the Test area (9 symbols) | `.claude/skills/generated/test/SKILL.md` |
| Work in the Presets area (9 symbols) | `.claude/skills/generated/presets/SKILL.md` |
| Work in the Cluster_121 area (8 symbols) | `.claude/skills/generated/cluster-121/SKILL.md` |
| Work in the Cluster_71 area (7 symbols) | `.claude/skills/generated/cluster-71/SKILL.md` |
| Work in the Scripts area (6 symbols) | `.claude/skills/generated/scripts/SKILL.md` |

<!-- gitnexus:end -->
