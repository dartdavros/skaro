import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'skaro-openrouter-build-'));
const plan = process.argv[4] === '--plan';
const buildDirectory = plan ? resolve('apps/desktop/out/main') : directory;
const entry = plan ? 'verify-model-plan.cjs' : 'live.cjs';
try {
  if (
    process.argv.length !== 4 &&
    !(plan && process.argv.length === 7) &&
    !(
      process.argv.length === 5 &&
      ['--context', '--long-context', '--prepare-context'].includes(process.argv[4])
    )
  )
    throw new Error('Credential reference and revision required');
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: resolve('apps/desktop/src/main/credentials/openrouter-live.ts'),
      outDir: buildDirectory,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { entryFileNames: entry, format: 'cjs' },
      },
    },
  });
  if (process.argv[4] === '--prepare-context') {
    console.log('Context acceptance entry compiled; no credential host or API request started.');
  } else {
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
    const long = process.argv[4] === '--long-context';
    let complete = !long;
    for (let phase = 0; phase < (long ? 4 : 1); phase++) {
      let needsRestart = false;
      const child = spawn(
        require('electron'),
        [join(buildDirectory, entry), ...process.argv.slice(2)],
        {
          env,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          serialization: 'json',
        },
      );
      const timeout = setTimeout(() => child.kill(), long ? 1_800_000 : 240_000);
      child.on('message', (message) => {
        console.log(JSON.stringify(message));
        if (message?.type === 'long-context') {
          complete = message.proof.complete === true;
          needsRestart = message.proof.complete === false;
        }
      });
      process.exitCode = await new Promise((done) => {
        child.once('exit', (code) => done(code ?? 1));
        child.once('error', () => done(1));
      });
      clearTimeout(timeout);
      if (process.exitCode !== 0 || complete) break;
      if (!needsRestart)
        throw new Error('Long session stopped without a durable restart checkpoint');
    }
    if (!complete) process.exitCode = 1;
  }
} catch {
  console.error(
    'Live OpenRouter acceptance could not complete; no fake API result was substituted.',
  );
  process.exitCode = 1;
} finally {
  if (plan) await rm(join(buildDirectory, entry), { force: true });
  await rm(directory, { recursive: true, force: true });
}
