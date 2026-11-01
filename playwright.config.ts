import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the showcase game on the local mock RGS (which plays the template's real
// math folder). They drive the real HUD and the real round loop — no backend needed.
const PORT = 5311;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm --filter artubeplate-showcase exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
