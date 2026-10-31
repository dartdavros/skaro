// The renderer alone in a browser, with an in-memory bridge (src/renderer/src/mock-bridge.ts).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { agentCatalog } from '@skaro/agents';

export default defineConfig({
  root: 'src/renderer',
  plugins: [svelte()],
  // Real presentation metadata only; preview never loads native agent runtimes.
  define: { 'import.meta.env.SKARO_AGENT_CATALOG': JSON.stringify(agentCatalog()) },
  server: { port: 4790, strictPort: true },
});
