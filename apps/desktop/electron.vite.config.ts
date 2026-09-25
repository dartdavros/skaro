import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [svelte()],
    // Own port on 127.0.0.1: the default 5173 is often taken by other projects' dev servers,
    // and the window would load their page instead of Skaro.
    server: { host: '127.0.0.1', port: 4791, strictPort: true },
  },
});
