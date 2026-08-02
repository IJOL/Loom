import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@loom/plugin-sdk': join(ROOT, 'packages', 'loom-plugin-sdk', 'src', 'index.ts') },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts', 'src/**/*.dsp.test.ts', 'src/**/*.wiring.test.ts',
      'packages/**/*.test.ts', 'plugins/**/*.test.ts',
      'tools/**/*.test.mjs',
      // A tool that drives the DSP kernel has to be TypeScript — it imports the
      // renderers and their types — so tools/ carries both extensions.
      'tools/**/*.test.ts',
    ],
    globals: false,
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
    // Run test files serially in a single worker. The DSP layer renders through
    // node-web-audio-api's OfflineAudioContext, which is not safe under vitest's
    // default parallel forks: concurrent renders intermittently return NaN /
    // wrong-pitch buffers, making `.dsp.test.ts` files flaky (the failing test
    // moves run to run, including unrelated ones). Serial execution is fully
    // deterministic (587/587 green). Cost: ~45s vs ~8s — acceptable for this suite.
    fileParallelism: false,
  },
});
