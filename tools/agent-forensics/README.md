# Agent-session forensics

Not part of the Loom build. These scripts inspect Claude Code / agent-workflow
artifacts on this machine — `agent-*.jsonl` transcripts, workflow journals, and
Chrome's history database — to recover what a past run did or found.

They live here, fenced off, because they are developed alongside Loom and are
useful when a long agent run over this repo needs archaeology; nothing in
`src/`, `plugins/` or the build ever imports them.

- `index-workflow-results.mjs` — index a workflow journal's results by agent.
- `find-in-workflow.mjs` — search across a workflow's transcripts.
- `extract-workflow-urls.mjs` — pull the URLs a workflow's agents visited.
- `chrome-history-search.mjs` — query Chrome's history SQLite (`node:sqlite`,
  Node 22+).
