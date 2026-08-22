# Archive — design documents whose work has shipped

Everything in here describes a round that is **finished and merged**. Nothing in
here is a backlog, and nothing in here is a plan anybody should pick up. What is
still open lives in one file: [`../REMAINING-WORK.md`](../REMAINING-WORK.md).

Kept rather than deleted, on 2026-08-22. The convention until then was to delete
a spec once its work shipped and recover the rationale from git history
(`git log --diff-filter=D --name-only -- docs/superpowers/`). That works, but it
asks a person to know a document existed before they can look for it, and two of
these are **approved mockups** — which `CLAUDE.md` calls committed artifacts
precisely because one was lost by being left outside the tree.

## What is in here

`specs/` is the design half — what a round was for, what it decided, and what it
deliberately did not do. `plans/` is the task half. They pair by date and topic.

The two `.html` files are approved mockups. Read them with their spec beside
them: they are what "done" was measured against, and a spec that quietly dropped
part of an approved look is the failure the mockup rule exists to catch.

## How to read one

**As history, not as instructions.** These were true when they were written and
several are not true now — a spec may describe a module that has since been
renamed, absorbed or deleted. `2026-08-07-weave-panel-dinamico.md` carries an
amendment at the top warning that its own tasks 5–8 describe an approach that
was built and then reverted, which is the shape of the risk in general.

**The code is the truth.** If a document here disagrees with `src/`, the
document is what is wrong. Verify before acting on anything you find.
