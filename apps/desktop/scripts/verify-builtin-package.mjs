import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, normalize } from 'node:path';
import { desktop, bundleMetadata } from './bundle-metadata.mjs';

// Inspect a real electron-builder Windows x64 --dir output. No installer/process/model is run.
if (process.argv.length !== 3)
  throw new Error('Usage: verify-builtin-package.mjs WIN_X64_UNPACKED');
const directory = resolve(process.argv[2]);
const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve('electron-builder/package.json'));
const packaging = createRequire(builder.resolve('app-builder-lib/package.json'));
const asar = packaging('@electron/asar');
const archive = join(directory, 'resources', 'app.asar');
const executable = join(directory, 'Skaro.exe');
const hash = (buffer) => createHash('sha512').update(buffer).digest('base64');
const fileHash = async (file) => {
  const digest = createHash('sha512');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('base64');
};
const handle = await open(executable, 'r');
try {
  const dos = Buffer.alloc(64);
  await handle.read(dos, 0, dos.length, 0);
  assert.equal(dos.toString('ascii', 0, 2), 'MZ');
  const pe = Buffer.alloc(6);
  await handle.read(pe, 0, pe.length, dos.readUInt32LE(60));
  assert.equal(pe.readUInt32LE(0), 0x00004550);
  assert.equal(pe.readUInt16LE(4), 0x8664, 'The real executable must be Windows x64');
} finally {
  await handle.close();
}
const paths = asar
  .listPackage(archive)
  .map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''));
const required = [
  'out/main/index.js',
  'out/main/native-worker.js',
  'out/main/agent-runtime-worker.js',
  'out/main/agent-credential-worker.js',
  'out/main/agent-command-worker.js',
  'out/main/background-worker.js',
  'out/main/graph-worker.js',
  'out/preload/index.js',
  'out/renderer/index.html',
];
const entries = [];
for (const path of required) {
  assert(paths.includes(path), `Missing packaged entry: ${path}`);
  const actual = asar.extractFile(archive, normalize(path));
  const expected = await readFile(resolve(desktop, path));
  assert.equal(
    hash(actual),
    hash(expected),
    `Packaged entry differs from the current build: ${path}`,
  );
  entries.push({ path, bytes: actual.byteLength, sha512: hash(actual) });
}
const compiled = [];
const inspectCompiled = async (relative) => {
  for (const entry of await readdir(resolve(desktop, relative), { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await inspectCompiled(path);
    else if (entry.isFile()) {
      assert(paths.includes(path), `Missing compiled asset: ${path}`);
      const expected = await readFile(resolve(desktop, path));
      assert.equal(
        hash(asar.extractFile(archive, normalize(path))),
        hash(expected),
        `Compiled asset mismatch: ${path}`,
      );
      compiled.push({ path, sha512: hash(expected) });
    } else throw new Error(`Unexpected compiled asset type: ${path}`);
  }
};
await inspectCompiled('out');
compiled.sort((left, right) => left.path.localeCompare(right.path));
const metadata = JSON.parse(
  await readFile(join(directory, 'resources', 'skaro-bundle.json'), 'utf8'),
);
assert.deepEqual(metadata, await bundleMetadata());
const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(manifest.main, './out/main/index.js');
assert.equal(manifest.version, metadata.bundleVersion);
assert(
  !paths.some((path) => /^out\/main\/verify-/.test(path)),
  'Temporary verification entries must not ship',
);
assert(
  !paths.some((path) => /^(?:(?:\.git|\.skaro|verification)(?:\/|$)|\.env(?:\.|\/|$))/.test(path)),
  'Project/owner state must not ship',
);
const proof = {
  platform: 'win32-x64',
  format: 'electron-builder-unpacked',
  bundleVersion: metadata.bundleVersion,
  currentBuildEntriesMatch: true,
  allCompiledAssetsMatch: true,
  compiledAssets: compiled.length,
  compiledTreeSha512: hash(Buffer.from(JSON.stringify(compiled))),
  managedPinsUnchanged: true,
  verificationEntriesAbsent: true,
  projectStateAbsent: true,
  runtimeExecutionChecked: false,
  modelRequests: 0,
  entries,
  executableSha512: await fileHash(executable),
  archiveSha512: await fileHash(archive),
};
const output = join(directory, 'builtin-runtime-proof.json');
await writeFile(output, JSON.stringify(proof, null, 2));
console.log(
  JSON.stringify({
    type: 'builtin-package',
    directory,
    proof: output,
    entries: entries.length,
    platform: proof.platform,
    bundleVersion: proof.bundleVersion,
  }),
);
