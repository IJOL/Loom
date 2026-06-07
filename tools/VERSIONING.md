# Versioning

Loom uses a simple, music-themed version scheme:

```
v0.N - Codename
```

`v0.1` is the first version; its codename is **Downbeat**. Each subsequent minor
gets the next rhythm/song-structure codename from the ordered list in
[`tools/version-codenames.json`](version-codenames.json) (index 0 = v0.1, index
1 = v0.2, …). So the codename for minor `N` is `codenames[N - 1]`:

| Version | Codename    |
| ------- | ----------- |
| v0.1    | Downbeat    |
| v0.2    | Upbeat      |
| v0.3    | Backbeat    |
| …       | …           |

## Source of truth

[`version.json`](../version.json) at the repo root:

```json
{ "version": "0.1", "codename": "Downbeat" }
```

`package.json`'s `"version"` is kept in sync as `0.{minor}.0` (semver-shaped).

## How it shows up

`vite.config.ts` reads `version.json` at config time and injects two compile-time
constants via `define`:

- `__APP_VERSION__` → e.g. `"0.1"`
- `__APP_CODENAME__` → e.g. `"Downbeat"`

`src/main.ts` writes them into the header next to the **LOOM** logo as
`v0.1 · Downbeat` (middle-dot separator). The values are inlined into the bundle
at build time — you can confirm a deployed build by grepping `dist/assets/*.js`
for the version string and codename.

## How the bump works

[`tools/bump-version.mjs`](bump-version.mjs) reads `version.json`, increments the
minor by one, looks up the new codename, and rewrites both `version.json` and
`package.json`. It prints `Bumped to v0.N - Codename`. If the codename list ever
runs out it wraps with modulo, so it never crashes.

### Automatic bump on push (trailing by one)

A tracked git hook, [`tools/git-hooks/pre-push`](git-hooks/pre-push), runs the
bump on every `git push` and commits the result. It is installed into
`.git/hooks/pre-push` by [`tools/install-hooks.mjs`](install-hooks.mjs), which is
wired as the npm `prepare` script — so `npm install` installs it.

**Trailing-by-one:** a pre-push hook runs *after* git has already computed the
commits to push, so the bump commit it creates **cannot** join the push in
flight. It rides your **next** push instead. This is expected. The hook never
blocks a push: any failure inside it is swallowed and the push proceeds.

## Bump manually

```sh
npm run bump
```

This is the same script the hook runs. Commit the changed `version.json` and
`package.json` yourself when bumping manually.
