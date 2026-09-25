import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Hosted macOS runners sometimes take tens of seconds to start an unsigned build.
  timeout: process.env['CI'] ? 180_000 : 60_000,
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  // A trace of every failed test, for failures that only happen on a CI runner.
  use: { trace: 'retain-on-failure' },
});
