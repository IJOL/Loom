#!/usr/bin/env node
/**
 * bump-version.mjs — advances Loom's app version by one minor step.
 *
 * Scheme: `v0.N · alpha · Codename`. v0.1 is the first version (codename
 * "Downbeat"). Each minor gets a music/rhythm codename from
 * tools/version-codenames.json (ordered; index 0 = v0.1, index 1 = v0.2, …), so
 * the codename for minor N is codenames[N - 1]. The project is in the "alpha"
 * stage, recorded alongside the version.
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
// Codename for minor M is codenames[M - 1]; wrap with modulo if we run out so a
// bump can never crash once the list is exhausted.
const idx = nextMinor - 1;
const codename = idx < codenames.length
  ? codenames[idx]
  : codenames[idx % codenames.length];

const nextVersion = `${major}.${nextMinor}`;

// 1) version.json — the source of truth. The project stays in the "alpha" stage.
const nextVersionJson = { ...current, version: nextVersion, stage: 'alpha', codename };
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

console.log(`Bumped to v${nextVersion} · alpha · ${codename}`);
