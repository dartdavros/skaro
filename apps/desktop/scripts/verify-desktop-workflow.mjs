import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
export async function verifyDesktopWorkflow(name, verificationEnvironment = {}, lifecycle = {}) {
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve(`apps/desktop/src/main/verification/${name}-workflow-live.ts`),
      outDir: resolve('apps/desktop/out/main'),
      emptyOutDir: false,
      rollupOptions: {
        external: ['electron'],
        output: { entryFileNames: `${name}-workflow.cjs`, format: 'cjs' },
      },
    },
  });
  const env = { ...cleanCommandEnvironment(), ...verificationEnvironment };
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
    [resolve(`apps/desktop/out/main/${name}-workflow.cjs`)],
    {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  child.on('message', (message) => {
    console.log(JSON.stringify(message));
    lifecycle.onMessage?.(message, child);
  });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = lifecycle.exitCode?.(code) ?? code ?? 1;
  });
}
