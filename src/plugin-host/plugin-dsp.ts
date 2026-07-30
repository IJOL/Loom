// Getting a plugin's per-sample DSP into the two realms that run it.
//
// ORDER MATTERS in the worklet: loom-processor.ts installs globalThis.Loom
// there, so its addModule must have resolved before any plugin dsp.js is added.
// Callers pass a context whose Loom module is already loaded.

/** Add every plugin dsp.js to a context's AudioWorklet, sequentially. */
export async function loadPluginDspModules(ctx: BaseAudioContext, urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await ctx.audioWorklet.addModule(url);
    } catch (e) {
      console.warn(`[plugin-host] worklet module failed: ${url}`, e);
    }
  }
}

/** Import every plugin dsp.js on the MAIN thread too — the offline exporter runs
 *  the same pure kernel here, so without this an export would render silence for
 *  every plugin engine. */
export async function importPluginDspOnMainThread(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await import(/* @vite-ignore */ url);
    } catch (e) {
      console.warn(`[plugin-host] main-thread dsp import failed: ${url}`, e);
    }
  }
}
