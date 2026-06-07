#!/usr/bin/env node
/**
 * install-hooks.mjs — copies tracked git hooks into .git/hooks so they actually
 * run. Wired as the npm "prepare" script, so `npm install` installs them.
 *
 * Resilient by design: if .git/hooks is absent (e.g. a CI checkout without a
 * full repo, or a npm install run outside a working tree) it logs a warning and
 * exits 0 — it must never break `npm install`.
 */
import { copyFileSync, existsSync, mkdirSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC_DIR = join(HERE, 'git-hooks');

// Resolve the git hooks dir. In a normal clone it's <root>/.git/hooks; in a
// worktree .git is a FILE pointing at the real gitdir, so fall back gracefully.
function gitHooksDir() {
  const dotGit = join(ROOT, '.git');
  if (!existsSync(dotGit)) return null;
  try {
    const st = statSync(dotGit);
    if (st.isDirectory()) return join(dotGit, 'hooks');
  } catch {
    return null;
  }
  // .git is a file (worktree / submodule). We don't parse it here; hooks live in
  // the main checkout's .git/hooks, so just skip with a warning.
  return null;
}

function main() {
  if (!existsSync(SRC_DIR)) {
    console.warn(`install-hooks: no hooks source dir at ${SRC_DIR}; skipping.`);
    return;
  }
  const hooksDir = gitHooksDir();
  if (!hooksDir) {
    console.warn('install-hooks: no .git/hooks directory (not a primary working tree?); skipping hook install.');
    return;
  }
  try {
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
    for (const name of readdirSync(SRC_DIR)) {
      const from = join(SRC_DIR, name);
      if (!statSync(from).isFile()) continue;
      const to = join(hooksDir, name);
      copyFileSync(from, to);
      try {
        chmodSync(to, 0o755); // no-op semantics on Windows, harmless.
      } catch {
        /* chmod is best-effort */
      }
      console.log(`install-hooks: installed ${name} -> ${to}`);
    }
  } catch (err) {
    // Never fail npm install over a hook copy problem.
    console.warn('install-hooks: could not install hooks:', err instanceof Error ? err.message : String(err));
  }
}

main();
