import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

export default defineConfig({
  main: {
    build: {
      // Keep synchronous startup imports in the build, rather than resolving
      // hundreds of YAML/updater modules from node_modules on every launch.
      externalizeDeps: { exclude: ['yaml', 'electron-updater'] },
      rollupOptions: {
        external: ['original-fs'],
        output: {
          banner: (chunk) =>
            chunk.name === 'index'
              ? readFileSync(resolve('scripts/startup-load-probe.cjs'), 'utf8')
              : '',
          footer: (chunk) =>
            chunk.name === 'index'
              ? "if (process.env.SKARO_LOAD_TRACE) globalThis[Symbol.for('skaro.startupLoads')].stop();"
              : '',
        },
        input: {
          index: resolve('src/main/index.ts'),
          'background-worker': resolve('src/main/background/worker.ts'),
          'native-worker': resolve('src/main/native/worker.ts'),
          'agent-runtime-worker': resolve('../../packages/agent-runtime/src/worker.ts'),
          'agent-command-worker': resolve(
            '../../packages/agent-runtime/src/tools/command-worker.ts',
          ),
          'graph-worker': resolve('src/main/graph/worker.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: {
    worker: { format: 'es' },
    plugins: [svelte()],
    // These imports are reached through lazy views and a worker, beyond the initial scan.
    // Prebundle them before mounting Svelte so navigation cannot trigger a runtime replacement.
    optimizeDeps: { include: ['highlight.js/lib/common', 'graphology-layout-forceatlas2'] },
    // Own port on 127.0.0.1: the default 5173 is often taken by other projects' dev servers,
    // and the window would load their page instead of Skaro.
    server: { host: '127.0.0.1', port: 4791, strictPort: true },
  },
});
