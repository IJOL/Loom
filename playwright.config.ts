import { defineConfig, devices } from '@playwright/test';

// Playwright runs against `vite preview` (production build) so the tests
// match what users see, not the dev server's HMR artifacts. The webServer
// block boots `preview` automatically and re-uses an existing instance if
// the port is already taken.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,            // Web Audio + single dev server → serial
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
