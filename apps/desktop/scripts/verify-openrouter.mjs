import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'skaro-openrouter-build-'));
try {
  if (process.argv.length !== 4) throw new Error('Credential reference and revision required');
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: resolve('apps/desktop/src/main/credentials/openrouter-live.ts'),
      outDir: directory,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { entryFileNames: 'live.cjs', format: 'cjs' },
      },
    },
  });
  const env = cleanCommandEnvironment();
  for (const key of [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
  ])
    if (process.env[key]) env[key] = process.env[key];
  const child = spawn(
    require('electron'),
    [join(directory, 'live.cjs'), ...process.argv.slice(2)],
    {
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    },
  );
  const timeout = setTimeout(() => child.kill(), 240_000);
  child.on('message', (message) => console.log(JSON.stringify(message)));
  process.exitCode = await new Promise((done) => {
    child.once('exit', (code) => done(code ?? 1));
    child.once('error', () => done(1));
  });
  clearTimeout(timeout);
} catch {
  console.error(
    'Live OpenRouter acceptance could not complete; no fake API result was substituted.',
  );
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
