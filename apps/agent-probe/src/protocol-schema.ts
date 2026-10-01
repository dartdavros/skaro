import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { codexBinary } from './adapters.ts';

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, normalized(child)]),
    );
  }
  return value;
}

export function schemaSnapshot(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, file.name);
      if (file.isDirectory()) walk(path);
      else if (file.name.endsWith('.json')) {
        const body = normalized(JSON.parse(readFileSync(path, 'utf8')));
        hashes[relative(root, path).replaceAll('\\', '/')] = createHash('sha256')
          .update(JSON.stringify(body))
          .digest('hex');
      }
    }
  };
  walk(root);
  if (!Object.keys(hashes).length) throw new Error('Codex did not export any protocol schemas');
  return hashes;
}

export function compareSchemas(before: Record<string, string>, after: Record<string, string>) {
  return {
    added: Object.keys(after)
      .filter((key) => !(key in before))
      .sort(),
    removed: Object.keys(before)
      .filter((key) => !(key in after))
      .sort(),
    changed: Object.keys(after)
      .filter((key) => key in before && before[key] !== after[key])
      .sort(),
  };
}

export function exportProtocol(out: string, baseline?: string) {
  const binary = codexBinary().binary;
  const root = join(out, 'codex-schema');
  mkdirSync(root);
  // No server is started: this is the actual binary's local schema exporter.
  execFileSync(binary, ['app-server', 'generate-json-schema', '--experimental', '--out', root], {
    windowsHide: true,
    stdio: 'pipe',
    timeout: 60_000,
  });
  const hashes = schemaSnapshot(root);
  writeFileSync(join(out, 'codex-schema-hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
  const reference = baseline && join(baseline, 'codex-schema-hashes.json');
  const differences =
    reference && existsSync(reference)
      ? compareSchemas(JSON.parse(readFileSync(reference, 'utf8')), hashes)
      : null;
  return {
    version: execFileSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
    schemas: Object.keys(hashes).length,
    differences,
    ok: !differences || Object.values(differences).every((list) => list.length === 0),
  };
}
