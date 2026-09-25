import { defineConfig } from 'vitest/config';

// Unit tests of the main process; the UI is covered by Playwright (e2e/).
export default defineConfig({
  test: {
    name: '@skaro/desktop',
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
  },
});
