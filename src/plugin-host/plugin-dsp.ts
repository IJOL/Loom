// Getting a plugin's per-sample DSP into the two realms that run it.
//
// ORDER MATTERS in the worklet: loom-processor.ts installs globalThis.Loom
// there, so its addModule must have resolved before any plugin dsp.js is added.
// Callers pass a context whose Loom module is already loaded.
//
// Both paths go through module-loader: a plugin lives in public/, which the Vite
// dev server refuses to serve as a module, so the source is fetched and
// evaluated through a blob: URL instead. Same behaviour in dev and in the build.
import { addPluginWorkletModule, importPluginModule } from './module-loader';

/** Add every plugin dsp.js to a context's AudioWorklet, sequentially. */
export async function loadPluginDspModules(ctx: BaseAudioContext, urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await addPluginWorkletModule(ctx, url);
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
      await importPluginModule(url);
    } catch (e) {
      console.warn(`[plugin-host] main-thread dsp import failed: ${url}`, e);
    }
  }
}
