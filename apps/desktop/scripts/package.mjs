import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { desktop, writeBundleMetadata } from './bundle-metadata.mjs';

const require = createRequire(import.meta.url);
const bundle = await writeBundleMetadata();
const child = spawn(
  process.execPath,
  [
    require.resolve('electron-builder/cli.js'),
    ...process.argv.slice(2),
    '--publish',
    'never',
    `--config.extraMetadata.version=${bundle.bundleVersion}`,
  ],
  { cwd: desktop, stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
