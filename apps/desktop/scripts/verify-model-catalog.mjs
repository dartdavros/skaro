import { build } from 'vite';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const proxy = process.env.SKARO_VERIFY_PROXY;
if (proxy !== 'http://127.0.0.1:10809') throw new Error('The explicit owner VPN proxy is required');
const require = createRequire(import.meta.url);
const output = resolve('apps/desktop/out/main/verify-model-catalog.cjs');
try {
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve('apps/desktop/src/main/verification/model-catalog-live.ts'),
      outDir: resolve('apps/desktop/out/main'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { entryFileNames: 'verify-model-catalog.cjs', format: 'cjs' },
      },
    },
  });
  const env = cleanCommandEnvironment();
  env.SKARO_VERIFY_PROXY = proxy;
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
    if (process.env[name]) env[name] = process.env[name];
  const child = spawn(require('electron'), [output], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  child.on('message', (message) => console.log(JSON.stringify(message)));
  const timer = setTimeout(() => child.kill(), 90_000);
  process.exitCode = await new Promise((done) => {
    child.once('exit', (code) => done(code ?? 1));
    child.once('error', () => done(1));
  });
  clearTimeout(timer);
} finally {
  await rm(output, { force: true });
}
