import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.dsp.test.ts', 'src/**/*.wiring.test.ts', 'tools/**/*.test.mjs'],
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
