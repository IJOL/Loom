import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// The whole plugin design rests on this: a module added to the AudioWorklet at
// runtime must be able to publish into the worklet's global scope, and a LATER
// module — plus any processor constructed afterwards — must see it.
//
// Separately-added worklet modules do NOT share module instances, so an imported
// registry would give each one its own copy. That is exactly why the plugin ABI
// is a global object (globalThis.Loom) and not an exported function.
//
// Each addModule is reported SEPARATELY, so a failure names the mechanism that
// broke instead of collapsing into one opaque "unable to load a worklet module".

const HOST_MODULE = `
  globalThis.Loom = {
    apiVersion: 1,
    renderers: {},
    registerRenderer(id, make) { globalThis.Loom.renderers[id] = make; },
  };
  class ProbeProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      const ids = Object.keys(globalThis.Loom.renderers).sort();
      // Actually CALL one, so this proves a usable factory crossed the boundary,
      // not merely that a key exists.
      const sample = ids.length ? globalThis.Loom.renderers[ids[0]]()(0) : null;
      this.port.postMessage({ ids, sample, apiVersion: globalThis.Loom.apiVersion });
    }
    process() { return false; }
  }
  registerProcessor('probe-processor', ProbeProcessor);
`;

const BLOB_PLUGIN = `Loom.registerRenderer('from-blob', () => (t) => 0.25);`;
const HTTP_PLUGIN = `Loom.registerRenderer('from-http', () => (t) => 0.5);`;

// vite preview serves dist/, so a file written there is fetched over plain http
// exactly like public/plugins/<id>/dsp.js will be. Route interception is
// deliberately NOT used: worklet module fetches do not necessarily go through
// the page's request interception, and that doubt is the thing under test.
const DIST_PROBE = join(process.cwd(), 'dist', 'probe-plugin.js');

test.beforeAll(() => { writeFileSync(DIST_PROBE, HTTP_PLUGIN); });
test.afterAll(() => { rmSync(DIST_PROBE, { force: true }); });

test('an externally added worklet module registers into the shared global scope', async ({ page }) => {
  await page.goto('/');

  const r = await page.evaluate(async ({ hostSrc, blobSrc }) => {
    const steps: Record<string, string> = {};
    const attempt = async (name: string, fn: () => Promise<unknown>) => {
      try { await fn(); steps[name] = 'ok'; }
      catch (e) { steps[name] = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
    };
    const blobUrl = (src: string) => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));

    const ctx = new AudioContext();
    let msg: { ids: string[]; sample: number | null; apiVersion: number } | null = null;
    try {
      await attempt('host-blob', () => ctx.audioWorklet.addModule(blobUrl(hostSrc)));
      await attempt('plugin-blob', () => ctx.audioWorklet.addModule(blobUrl(blobSrc)));
      await attempt('plugin-http', () => ctx.audioWorklet.addModule('/probe-plugin.js'));
      await attempt('construct-node', async () => {
        const node = new AudioWorkletNode(ctx, 'probe-processor');
        msg = await new Promise((resolve, reject) => {
          node.port.onmessage = (e) => resolve(e.data);
          setTimeout(() => reject(new Error('worklet never answered')), 5000);
        });
      });
    } finally {
      await ctx.close();
    }
    return { steps, msg };
  }, { hostSrc: HOST_MODULE, blobSrc: BLOB_PLUGIN });

  // Reported before the assertions so a failure prints WHICH mechanism broke.
  console.log('addModule steps:', JSON.stringify(r.steps, null, 2), 'msg:', JSON.stringify(r.msg));

  expect(r.steps['host-blob']).toBe('ok');
  expect(r.steps['plugin-blob']).toBe('ok');
  expect(r.steps['plugin-http']).toBe('ok');
  expect(r.steps['construct-node']).toBe('ok');
  // Both plugin modules reached the SAME registry the host module created.
  expect(r.msg?.ids).toEqual(['from-blob', 'from-http']);
  // And the factory that crossed the boundary is callable and returns its value.
  expect(r.msg?.sample).toBe(0.25);
  expect(r.msg?.apiVersion).toBe(1);
});
