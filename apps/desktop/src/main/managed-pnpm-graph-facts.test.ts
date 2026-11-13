import { expect, it } from 'vitest';
import {
  encodePnpmGraphFacts,
  pnpmManifestIdentity,
  validatePnpmGraphFacts,
} from './managed-pnpm-graph-facts';
import { PNPM_CONFIGURATION } from './managed-pnpm-lock';

// In-memory archive manifest/lock metadata only; never creates an archive or an installation.
const manifest = Buffer.from(
  JSON.stringify({ name: 'tool', version: '1.0.0', bin: { tool: './cli.js' } }),
);
const identity = pnpmManifestIdentity(manifest);
const lock = {
  lockfileVersion: '9.0',
  settings: {},
  importers: { '.': { devDependencies: { tool: { specifier: '1.0.0', version: '1.0.0' } } } },
  packages: {
    'tool@1.0.0': { resolution: { integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}` } },
  },
  snapshots: { 'tool@1.0.0': {} },
};
const fact = () => ({
  manifestDigest: identity.digest,
  bins: [{ command: 'tool', target: 'cli.js' }],
});
const document = () => ({ version: 1, packages: { 'tool@1.0.0': fact() } });

it('roundtrips exact bounded archive-bound facts and distinguishes the new cache contract', () => {
  const facts = validatePnpmGraphFacts(lock, document());
  const bytes = encodePnpmGraphFacts(lock, facts);
  expect(validatePnpmGraphFacts(lock, JSON.parse(bytes.toString()))).toEqual(facts);
  expect(identity.id).toBe('tool@1.0.0');
  expect(PNPM_CONFIGURATION.installedGraph).toBe('original-lock-archive-manifests-edges-bins-v1');
  expect(PNPM_CONFIGURATION.runtimeBudget).toBe('verified-expanded-bytes-before-extraction-v1');
  const changed = Buffer.from(manifest.toString().replace('./cli.js', 'cli.js'));
  expect(pnpmManifestIdentity(changed).digest).not.toBe(identity.digest);
});

it('rejects missing/extra package facts and malformed digest, schema or executable targets', () => {
  for (const input of [
    { version: 1, packages: {} },
    { version: 1, packages: { ...document().packages, 'extra@1.0.0': fact() } },
    { ...document(), version: 2 },
    { ...document(), extra: true },
    { version: 1, packages: { 'tool@1.0.0': { ...fact(), manifestDigest: 'untrusted' } } },
    { version: 1, packages: { 'tool@1.0.0': { ...fact(), extra: true } } },
    {
      version: 1,
      packages: {
        'tool@1.0.0': { ...fact(), bins: [{ command: 'tool', target: '../outside.js' }] },
      },
    },
    {
      version: 1,
      packages: { 'tool@1.0.0': { ...fact(), bins: [{ command: 'tool', target: './cli.js' }] } },
    },
    {
      version: 1,
      packages: {
        'tool@1.0.0': {
          ...fact(),
          bins: [
            { command: 'tool', target: 'cli.js' },
            { command: 'Tool', target: 'cli.js' },
          ],
        },
      },
    },
  ])
    expect(() => validatePnpmGraphFacts(lock, input)).toThrow();
  for (const value of ['{}', '[]', 'null', '{"name":"tool","version":1}'])
    expect(() => pnpmManifestIdentity(Buffer.from(value))).toThrow();
  expect(() => pnpmManifestIdentity(Buffer.alloc(1024 ** 2 + 1))).toThrow();
});
