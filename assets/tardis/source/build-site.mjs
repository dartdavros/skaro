import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const destination = new URL('dist/site/', root);
await mkdir(destination, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('web/site.mjs', root))],
  outfile: fileURLToPath(new URL('tardis-easter-egg.js', destination)),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'inline',
  // Classic scripts with packaged bytes work on file:// without fetch or a CDN.
  loader: { '.glb': 'binary', '.mp3': 'dataurl', '.png': 'dataurl' },
});
await copyFile(new URL('web/site.css', root), new URL('tardis-flight.css', destination));
console.log('Built BAD WOLF integration:', fileURLToPath(destination));
