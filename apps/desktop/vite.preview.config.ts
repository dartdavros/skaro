// The renderer alone in a browser, with an in-memory bridge (src/renderer/src/mock-bridge.ts).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  plugins: [svelte()],
  server: { port: 4790, strictPort: true },
});
