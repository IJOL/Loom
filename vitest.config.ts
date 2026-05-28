import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.dsp.test.ts', 'src/**/*.wiring.test.ts'],
    globals: false,
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
  },
});
