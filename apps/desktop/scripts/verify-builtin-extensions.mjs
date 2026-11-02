// Launch actual Skaro services and registered project; no alternate HTTP server or seeded data.
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
if (!(
  process.argv.length === 2 ||
  (process.argv.length === 3 &&
    [
      '--native-verification',
      '--native-operations',
      '--native-lifetime',
      '--native-model-preflight',
      '--native-owner-input',
      '--native-owner-steer',
      '--project-scope',
      '--native-admissions',
      '--configured-credentials',
      '--configured-model-preflight',
      '--configured-owner-input',
      '--configured-context-input',
      '--configured-plan-payload',
      '--model-usage-report',
      '--native-admission-recovery',
      '--task-admission',
      '--task-launch-preflight',
    ].includes(process.argv[2])) ||
  (process.argv.length === 4 && process.argv[2] === '--browser') ||
  (process.argv.length === 5 &&
    ['--configured-plan-live', '--configured-plan-review'].includes(process.argv[2]))
))
  throw new Error(
    'Usage: verify-builtin-extensions.mjs [--native-verification | --native-operations | --native-lifetime | --native-model-preflight | --browser CAT_PILOT_PROJECT_ROOT]',
  );
const output = resolve('apps/desktop/out/main/verify-extensions.cjs');
const recoveryHost = resolve('apps/desktop/out/main/verify-admission-host.cjs');
try {
  if (process.argv[2] === '--native-admission-recovery')
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        ssr: resolve('apps/desktop/src/main/verification/admission-recovery-host.ts'),
        outDir: resolve('apps/desktop/out/main'),
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { entryFileNames: 'verify-admission-host.cjs', format: 'cjs' },
        },
      },
    });
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve('apps/desktop/src/main/verification/extensions-live.ts'),
      outDir: resolve('apps/desktop/out/main'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { entryFileNames: 'verify-extensions.cjs', format: 'cjs' },
      },
    },
  });
  const env = cleanCommandEnvironment();
  if (
    [
      '--configured-model-preflight',
      '--configured-owner-input',
      '--configured-context-input',
      '--configured-plan-payload',
      '--configured-plan-live',
      '--configured-plan-review',
      '--task-launch-preflight',
    ].includes(process.argv[2])
  ) {
    if (process.env.SKARO_VERIFY_PROXY !== 'http://127.0.0.1:10809')
      throw new Error('Configured model preflight requires the explicit owner VPN proxy');
    env.SKARO_VERIFY_PROXY = process.env.SKARO_VERIFY_PROXY;
  }
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
    if (process.env[name]) env[name] = process.env[name];
  const child = spawn(require('electron'), [output, ...process.argv.slice(2)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  child.on('message', (message) => console.log(JSON.stringify(message)));
  const timeout = setTimeout(() => child.kill(), 180_000);
  process.exitCode = await new Promise((done) => {
    child.once('exit', (code) => done(code ?? 1));
    child.once('error', () => done(1));
  });
  clearTimeout(timeout);
} finally {
  await rm(output, { force: true });
  if (process.argv[2] === '--native-admission-recovery') await rm(recoveryHost, { force: true });
}
