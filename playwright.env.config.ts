// Environment override for headless containers (Claude Code on the web, CI
// images) that ship a pre-installed Chromium. It mirrors playwright.config.ts
// but launches the browser already on disk under PLAYWRIGHT_BROWSERS_PATH
// (build 1194) instead of the build @playwright/test 1.60 would download, and
// drops the sandbox because those containers run as root.
//
// Opt-in only — `npm run test:e2e` is untouched:
//   npx playwright test --config=playwright.env.config.ts
//
// The path is pinned to this image's build; on a machine with the matching
// browsers installed, use the plain playwright.config.ts instead.
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
          args: ['--no-sandbox'],
        },
      },
    },
  ],
});
