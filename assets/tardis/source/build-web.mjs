import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const directory = new URL('dist/', root);
await mkdir(directory, { recursive: true });
const common = {
  entryPoints: [fileURLToPath(new URL('web/flight.mjs', root))],
  bundle: true,
  minify: true,
  target: 'es2022',
  legalComments: 'inline',
};
await build({
  ...common,
  format: 'esm',
  outfile: fileURLToPath(new URL('tardis-flight.js', directory)),
});
const result = await build({ ...common, format: 'iife', globalName: 'TardisFlight', write: false });
const model = await readFile(new URL('tardis-2005.glb', root));
const audio = await readFile(new URL('audio/tardis-noise.mp3', root));
const template = await readFile(new URL('web/preview.html', root), 'utf8');
const html = template
  .replace('__MODEL_BASE64__', model.toString('base64'))
  .replace('__AUDIO_BASE64__', audio.toString('base64'))
  .replace('__FLIGHT_BUNDLE__', () =>
    result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'),
  );
await writeFile(new URL('flight-preview.html', directory), html);
await copyFile(new URL('tardis-2005.glb', root), new URL('tardis-2005.glb', directory));
await copyFile(new URL('audio/tardis-noise.mp3', root), new URL('tardis-noise.mp3', directory));
console.log(
  'Built web module and standalone preview with the actual embedded GLB:',
  fileURLToPath(directory),
);
