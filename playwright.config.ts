import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', globalSetup: './tests/e2e/setup.mjs', fullyParallel: false, workers: 1,
  testMatch: process.env.E2E_MEDIA === '1' ? '**/media.spec.ts' : '**/auth.spec.ts',
  timeout: 45000, use: { baseURL: 'http://localhost:3300', trace: 'retain-on-failure',
    ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}) },
  reporter: [['list']],
});
