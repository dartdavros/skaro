import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(desktop, 'out/main/verify-follow-up-restore.cjs');
if (!process.env.SKARO_FOLLOW_UP_PROFILE || !process.argv[2])
  throw new Error('A real Cat-pilot profile and its previous builtin run ID are required');
try {
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve(desktop, 'e2e/task-follow-up-restore.ts'),
      outDir: resolve(desktop, 'out/main'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron', 'turndown'],
        output: {
          entryFileNames: 'verify-follow-up-restore.cjs',
          format: 'cjs',
          inlineDynamicImports: true,
        },
      },
    },
  });
  const code = await new Promise((ok, fail) => {
    const child = spawn(require('electron'), [output, process.argv[2]], {
      env: { ...process.env, SKARO_VERIFY_PROXY: 'http://127.0.0.1:10809' },
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', fail);
    child.once('exit', (code) => ok(code ?? 1));
  });
  process.exitCode = code;
} finally {
  await unlink(output).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
