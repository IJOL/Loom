// Getting a plugin's compiled JS into a realm — the main thread or an AudioWorklet.
//
// A shipped plugin is a STATIC ASSET (public/plugins/<id>/*.js). Importing that
// URL natively works in the production bundle but BREAKS under `npm run dev`:
// Vite's transform middleware intercepts the request and refuses, because a file
// in public/ may be referenced but never imported from source. Plugins would work
// in the build and fail in the dev server — the exact opposite of what you want
// while developing one.
//
// So: fetch the source and load it through a `blob:` URL. That bypasses the dev
// server's module graph entirely, behaves identically in both modes, and is the
// SAME mechanism a user-installed plugin will need, since its bytes will live in
// IndexedDB rather than at a URL. Plugin bundles are self-contained (esbuild
// inlines every dependency), so losing relative-import resolution against the
// original directory costs nothing.
//
// The worklet half is the path the spike proved in a real browser
// (tests/e2e/worklet-external-module.spec.ts): a blob-sourced module reaches the
// same worklet global scope as one served over http.

/** Fetch a module's source and wrap it in a `blob:` URL. Exported for tests. */
export async function moduleBlobUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const source = await res.text();
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

/** Evaluate a plugin module in THIS realm (main thread). */
export async function importPluginModule(url: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const blob = await moduleBlobUrl(url, fetchImpl);
  try {
    await import(/* @vite-ignore */ blob);
  } finally {
    // import() settles only after the module has been evaluated, so by here the
    // URL has done its job. Revoking keeps the blob out of the document's store.
    URL.revokeObjectURL(blob);
  }
}

/** Evaluate a plugin module inside a context's AudioWorklet global scope. */
export async function addPluginWorkletModule(
  ctx: BaseAudioContext, url: string, fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const blob = await moduleBlobUrl(url, fetchImpl);
  try {
    await ctx.audioWorklet.addModule(blob);
  } finally {
    URL.revokeObjectURL(blob);
  }
}
