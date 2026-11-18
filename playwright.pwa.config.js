import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4174/SchoolPot/',
    browserName: 'chromium',
    channel: process.env.GITHUB_ACTIONS === 'true' ? 'chrome' : undefined,
    headless: true,
  },
  webServer: {
    command: 'node tests/pwa/server.mjs',
    url: 'http://127.0.0.1:4174/SchoolPot/',
    timeout: 60000,
  },
  reporter: 'list',
});
