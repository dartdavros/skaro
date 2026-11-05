import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: resolve('apps/desktop/src/main/verification/environment-setup-live.ts'),
    outDir: resolve('apps/desktop/out/verification'),
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
      output: { entryFileNames: 'environment-setup.cjs', format: 'cjs' },
    },
  },
});
const env = cleanCommandEnvironment();
for (const name of [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ALLUSERSPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
])
  if (process.env[name]) env[name] = process.env[name];
const child = spawn(
  require('electron'),
  [resolve('apps/desktop/out/verification/environment-setup.cjs')],
  {
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  },
);
child.on('message', (message) => console.log(JSON.stringify(message)));
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
