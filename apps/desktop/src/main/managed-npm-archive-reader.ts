import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { NpmArchiveNodes } from './managed-npm-archive-nodes';
import { npmArchiveBins, type NpmArchiveBin } from './managed-npm-archive-bin';
import {
  NPM_INSTALL_BYTE_LIMIT,
  NPM_INSTALL_FILE_LIMIT,
  npmTarHeader,
  unsupportedNpmArchive as unsupported,
} from './managed-npm-tar';

/** Shared bounded decoder: both historical proof accounting and current unique-node accounting. */
export async function readNpmArchive(path: string) {
  const input = createReadStream(path),
    gunzip = createGunzip();
  input.on('error', (error) => gunzip.destroy(error));
  input.pipe(gunzip);
  const nodes = new NpmArchiveNodes(NPM_INSTALL_FILE_LIMIT);
  let pending = Buffer.alloc(0),
    skip = 0,
    ended = false,
    bytes = 0,
    legacyFiles = 0,
    inflated = 0;
  let archiveRoot: string | undefined;
  let capture = 0,
    captured: Buffer[] = [],
    packageSeen = false;
  let bins: NpmArchiveBin[] = [],
    manifestDigest = '';
  try {
    for await (const raw of gunzip) {
      const chunk = raw as Buffer;
      inflated += chunk.length;
      if (inflated > NPM_INSTALL_BYTE_LIMIT || !Number.isSafeInteger(inflated)) unsupported();
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        if (ended) {
          if (pending.some((value) => value !== 0)) unsupported();
          pending = Buffer.alloc(0);
          break;
        }
        if (skip) {
          const count = Math.min(skip, pending.length);
          if (capture) {
            const length = Math.min(capture, count);
            captured.push(pending.subarray(0, length));
            capture -= length;
            if (!capture) {
              const manifest = Buffer.concat(captured);
              manifestDigest = createHash('sha256').update(manifest).digest('hex');
              bins = npmArchiveBins(manifest);
              legacyFiles += bins.length * 4;
              captured = [];
            }
          }
          skip -= count;
          pending = pending.subarray(count);
          continue;
        }
        if (pending.length < 512) break;
        const entry = npmTarHeader(pending.subarray(0, 512));
        pending = pending.subarray(512);
        if (!entry) {
          ended = true;
          continue;
        }
        if (archiveRoot && archiveRoot !== entry.root) unsupported();
        archiveRoot ??= entry.root;
        bytes += entry.bytes;
        legacyFiles += entry.nodes;
        if (
          !Number.isSafeInteger(bytes) ||
          bytes > NPM_INSTALL_BYTE_LIMIT ||
          !Number.isSafeInteger(legacyFiles)
        )
          unsupported();
        nodes.add(entry);
        if (entry.path === archiveRoot + '/package.json') {
          if (packageSeen || entry.directory || !entry.bytes || entry.bytes > 1024 ** 2)
            unsupported();
          packageSeen = true;
          capture = entry.bytes;
        }
        skip = Math.ceil(entry.bytes / 512) * 512;
      }
    }
    if (!ended || skip || pending.length || capture || !packageSeen) unsupported();
    const inventory = nodes.inventory();
    for (const bin of bins)
      if (!inventory.some((node) => node.path === bin.target && !node.directory)) unsupported();
    return {
      bytes,
      nodes: inventory,
      bins: bins.map((bin) => bin.command),
      legacyFiles,
      manifestDigest,
      binTargets: bins,
    };
  } finally {
    input.destroy();
    gunzip.destroy();
  }
}
