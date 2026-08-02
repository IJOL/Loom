#!/usr/bin/env node
/**
 * bump-version.mjs — advances Loom's app version by one minor step.
 *
 * Scheme: `vMAJOR.MINOR · stage · Codename`. v0.1 was the first version
 * (codename "Downbeat"); v1.0 "Modulator" is the first beta. Each bump takes
 * the NEXT music/rhythm codename from tools/version-codenames.json and CARRIES
 * OVER the current stage.
 *
 * Neither the codename nor the stage is derived from the number any more. The
 * codename used to be `codenames[minor - 1]` and the stage was hardcoded to
 * 'alpha', which worked only while the app stayed on 0.x: the first bump after
 * v1.0 would have restarted the list at "Downbeat" AND demoted beta back to
 * alpha. Moving between stages is a deliberate edit of version.json, never
 * something a routine bump decides.
 *
 * It rewrites:
 *   - version.json            (the source of truth: { version, stage, codename })
 *   - package.json "version"  (kept in sync as 0.{minor}.0)
 *
 * Resilient by design: clear errors + non-zero exit on failure; if the codename
 * list runs out it wraps with modulo so it never crashes.
 *
 * Run manually with `npm run bump` (there is no automatic push-time bump).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERSION_PATH = join(ROOT, 'version.json');
const CODENAMES_PATH = join(HERE, 'version-codenames.json');
const PACKAGE_PATH = join(ROOT, 'package.json');
const LOCK_PATH = join(ROOT, 'package-lock.json');

function fail(msg, err) {
  console.error(`bump-version: ${msg}`);
  if (err) console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return fail(`could not read ${label} at ${path}`, err);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fail(`${label} at ${path} is not valid JSON`, err);
  }
}

const current = readJson(VERSION_PATH, 'version.json');
if (typeof current.version !== 'string') {
  fail(`version.json is missing a string "version" field (got ${JSON.stringify(current.version)})`);
}

// Parse "major.minor" — we only ever bump the minor. Tolerate a bare "0.N".
const match = /^(\d+)\.(\d+)/.exec(current.version.trim());
if (!match) {
  fail(`version.json "version" is not in major.minor form (got "${current.version}")`);
}
const major = Number(match[1]);
const minor = Number(match[2]);
if (!Number.isInteger(minor)) {
  fail(`could not parse a minor number from version "${current.version}"`);
}

const codenames = readJson(CODENAMES_PATH, 'version-codenames.json');
if (!Array.isArray(codenames) || codenames.length === 0) {
  fail('version-codenames.json must be a non-empty array of strings');
}

const nextMinor = minor + 1;
// The codename is the one AFTER the current one in the list — it is not derived
// from the version number. It used to be `codenames[minor - 1]`, which tied the
// two together and silently broke at the 1.0 boundary: the first bump after
// v1.0 would have restarted the list at "Downbeat". Falling back to the old
// index keeps a version.json whose codename is not in the list working.
const currentIdx = codenames.indexOf(current.codename);
const idx = currentIdx >= 0 ? currentIdx + 1 : nextMinor - 1;
const codename = codenames[idx % codenames.length];

const nextVersion = `${major}.${nextMinor}`;

// 1) version.json — the source of truth. The stage is CARRIED OVER, not forced:
// it used to be hardcoded to 'alpha', so the first bump after the move to beta
// would have quietly demoted the app back to alpha. Changing stage is a
// deliberate act — edit version.json — not something a routine bump decides.
const stage = typeof current.stage === 'string' && current.stage ? current.stage : 'alpha';
const nextVersionJson = { ...current, version: nextVersion, stage, codename };
try {
  writeFileSync(VERSION_PATH, JSON.stringify(nextVersionJson, null, 2) + '\n');
} catch (err) {
  fail('could not write version.json', err);
}

// 2) package.json "version" kept in sync as 0.{minor}.0 (semver-shaped).
const pkg = readJson(PACKAGE_PATH, 'package.json');
pkg.version = `${major}.${nextMinor}.0`;
try {
  writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n');
} catch (err) {
  fail('could not write package.json', err);
}

// 3) package-lock.json carries the root version TWICE — the top-level field and
//    packages[""].version — and npm rewrites both on the next install. Leaving
//    them behind meant every `npm install` after a bump produced a spurious
//    2-line diff that looked like someone had touched dependencies. Not fatal
//    (npm ci compares the dependency tree, not this field), just noise that
//    outlives the bump. Absent or malformed is tolerated: the lockfile is
//    generated, so a bump must never be the thing that fails over it.
try {
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  lock.version = pkg.version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = pkg.version;
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
} catch (err) {
  console.warn(`bump-version: left package-lock.json alone (${err instanceof Error ? err.message : String(err)})`);
}

console.log(`Bumped to v${nextVersion} · alpha · ${codename}`);
