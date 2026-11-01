import { build } from 'vite';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
const output = resolve('apps/desktop/out/main/verify-model-settings.cjs');
try {
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve('apps/desktop/src/main/verification/model-settings-readonly.ts'),
      outDir: resolve('apps/desktop/out/main'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { entryFileNames: 'verify-model-settings.cjs', format: 'cjs' },
      },
    },
  });
  const env = cleanCommandEnvironment();
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
    if (process.env[name]) env[name] = process.env[name];
  const child = spawn(require('electron'), [output, ...process.argv.slice(2)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  child.on('message', (message) => console.log(JSON.stringify(message)));
  const timer = setTimeout(() => child.kill(), 45_000);
  process.exitCode = await new Promise((resolve) => {
    child.once('exit', (code) => resolve(code ?? 1));
    child.once('error', () => resolve(1));
  });
  clearTimeout(timer);
} finally {
  await rm(output, { force: true });
}
