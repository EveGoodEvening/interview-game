import { defineConfig, devices } from '@playwright/test';

/** Dev server for the browser specs (the mock LLM / production server use 5450–5459). */
const PORT = 5199;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Specs are independent (fresh browser context each), so files run in parallel workers.
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone'],
    locale: 'zh-CN',
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /prod-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      // `npm run build` + `node server/index.ts` — slow, so it gets its own project and timeout.
      name: 'prod',
      testMatch: /prod-smoke\.spec\.ts/,
      timeout: 240_000,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    // HMR off: files saved during the run must not reload the page under test (see the config).
    command: `npx vite --config tests/e2e/vite.e2e.config.ts --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
