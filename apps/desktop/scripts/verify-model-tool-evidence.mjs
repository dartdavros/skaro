import { build } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

if (process.argv.length !== 4 || !/^[a-f0-9]{64}$/.test(process.argv[3]))
  throw new Error('Usage: verify-model-tool-evidence.mjs REVIEWED_PAYLOAD SHA256');
const output = resolve('apps/desktop/release/verification/verify-tool-evidence.mjs');
try {
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve('apps/desktop/src/main/verification/model-tool-evidence-readonly.ts'),
      outDir: resolve('apps/desktop/release/verification'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: { output: { entryFileNames: 'verify-tool-evidence.mjs', format: 'es' } },
    },
  });
  const env = cleanCommandEnvironment();
  if (!process.env.APPDATA) throw new Error('The real owner appData path is required');
  env.APPDATA = process.env.APPDATA;
  const child = spawn(process.execPath, [output, ...process.argv.slice(2)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const timeout = setTimeout(() => child.kill(), 60_000);
  process.exitCode = await new Promise((done) => {
    child.once('exit', (code) => done(code ?? 1));
    child.once('error', () => done(1));
  });
  clearTimeout(timeout);
} finally {
  await rm(output, { force: true });
}
