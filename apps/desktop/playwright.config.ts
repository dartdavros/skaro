import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  // A trace of every failed test, for failures that only happen on a CI runner.
  use: { trace: 'retain-on-failure' },
});
