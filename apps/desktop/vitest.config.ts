import { defineConfig } from 'vitest/config';

// Main process and pure renderer models; native UI behavior is covered by Playwright (e2e/).
export default defineConfig({
  test: {
    name: '@skaro/desktop',
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/renderer/**/*.test.ts'],
  },
});
