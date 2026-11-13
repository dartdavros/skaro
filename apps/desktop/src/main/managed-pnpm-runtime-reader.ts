import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { readCacheFile } from './managed-cache-files';
import { npmTarHeader } from './managed-npm-archive';
import { PNPM_VERSION } from './managed-pnpm-lock';

// Pinned official npm artifact, never Corepack/global state.
export const PNPM_RUNTIME_INTEGRITY =
  'sha512-ZUBYP0HMX2KOs9l3Ps7oAvT575kjzEW2mJD7R5kdSwkpZGlOw6T3OKQgyRijMwYsi5JdMS9C5PDCY+tgNVH5dw==';
export const PNPM_RUNTIME_BYTE_LIMIT = 32 * 1024 ** 2;
export const PNPM_RUNTIME_NODE_LIMIT = 8192;
interface RuntimeEntry {
  path: string;
  bytes: number;
  directory: boolean;
}
interface RuntimeSink {
  write(bytes: Buffer): Promise<void> | void;
  end(): Promise<void> | void;
}
function unsupported(): never {
  throw new Error('managed_pnpm_runtime_archive_unsupported');
}

/** One bounded decoder for extraction and inspection; visitors receive only verified package/ paths. */
export async function visitPnpmRuntimeArchive(
  root: string,
  archive: string,
  visit: (entry: RuntimeEntry) => Promise<RuntimeSink | void> | RuntimeSink | void,
): Promise<{ directories: string[]; expandedBytes: number }> {
  // Read once through the canonical, private nlink=1/stable-file guard. Decode these exact bytes
  // only AFTER the full pin matches; no second pathname open or verification/decode race.
  const { data } = await readCacheFile(root, archive, PNPM_RUNTIME_BYTE_LIMIT);
  if (`sha512-${createHash('sha512').update(data).digest('base64')}` !== PNPM_RUNTIME_INTEGRITY)
    throw new Error('managed_pnpm_runtime_integrity_mismatch');
  // Feed bounded slices rather than one compressed write (also bounding zlib's input queue).
  const input = Readable.from(
    (function* () {
      for (let offset = 0; offset < data.length; offset += 64 * 1024)
        yield data.subarray(offset, offset + 64 * 1024);
    })(),
  );
  const gunzip = createGunzip();
  input.on('error', (error) => gunzip.destroy(error));
  input.pipe(gunzip);
  const entries = new Set<string>(),
    nodes = new Map<string, { path: string; directory: boolean }>();
  let pending = Buffer.alloc(0),
    skip = 0,
    remaining = 0,
    inflated = 0,
    expandedBytes = 0,
    ended = false;
  let sink: RuntimeSink | void = undefined,
    packageChunks: Buffer[] | undefined,
    packageSeen = false;
  function node(path: string, directory: boolean) {
    const key = path.toLowerCase(),
      existing = nodes.get(key);
    if (existing && (existing.path !== path || existing.directory !== directory)) unsupported();
    nodes.set(key, { path, directory });
    if (nodes.size > PNPM_RUNTIME_NODE_LIMIT) unsupported();
  }
  async function finish() {
    if (packageChunks) {
      const pkg = JSON.parse(Buffer.concat(packageChunks).toString('utf8'));
      if (!pkg || pkg.name !== 'pnpm' || pkg.version !== PNPM_VERSION) unsupported();
      packageChunks = undefined;
    }
    await sink?.end();
    sink = undefined;
  }
  try {
    for await (const raw of gunzip) {
      const chunk = raw as Buffer;
      inflated += chunk.length;
      if (inflated > PNPM_RUNTIME_BYTE_LIMIT) unsupported();
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        if (ended) {
          if (pending.some((value) => value !== 0)) unsupported();
          pending = Buffer.alloc(0);
          break;
        }
        if (skip) {
          const count = Math.min(skip, pending.length),
            bytes = Math.min(count, remaining),
            body = pending.subarray(0, bytes);
          if (bytes) {
            packageChunks?.push(body);
            await sink?.write(body);
          }
          remaining -= bytes;
          skip -= count;
          pending = pending.subarray(count);
          if (!skip) await finish();
          continue;
        }
        if (pending.length < 512) break;
        const header = pending.subarray(0, 512),
          entry = npmTarHeader(header);
        pending = pending.subarray(512);
        if (!entry) {
          ended = true;
          continue;
        }
        // npmTarHeader accepts other npm roots; the runtime deliberately never does.
        if (entry.root !== 'package') unsupported();
        const path = entry.path.replace(/\/$/, '').split('/').slice(1).join('/'),
          directory = header[156] === 53,
          key = path.toLowerCase();
        if (entries.has(key)) unsupported();
        entries.add(key);
        if (entries.size > PNPM_RUNTIME_NODE_LIMIT) unsupported();
        if (!path) {
          if (!directory) unsupported();
          continue;
        }
        const parts = path.split('/');
        for (let length = 1; length < parts.length; length++)
          node(parts.slice(0, length).join('/'), true);
        node(path, directory);
        expandedBytes += entry.bytes;
        if (expandedBytes > PNPM_RUNTIME_BYTE_LIMIT) unsupported();
        if (path === 'package.json') {
          if (directory || !entry.bytes || entry.bytes > 1024 ** 2) unsupported();
          packageSeen = true;
          packageChunks = [];
        }
        sink = await visit({ path, bytes: entry.bytes, directory });
        remaining = entry.bytes;
        skip = Math.ceil(entry.bytes / 512) * 512;
        if (!skip) await finish();
      }
    }
    if (!ended || skip || pending.length || sink || !packageSeen) unsupported();
    for (const required of ['bin/pnpm.cjs', 'dist/pnpm.cjs'])
      if (nodes.get(required)?.directory !== false) unsupported();
    return {
      expandedBytes,
      directories: [...nodes.values()]
        .filter((node) => node.directory)
        .map((node) => node.path)
        .sort(),
    };
  } finally {
    input.destroy();
    gunzip.destroy();
  }
}
