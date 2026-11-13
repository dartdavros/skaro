import { expect, it } from 'vitest';
import { assertPnpmInstalledGraph, type PnpmInstalledNode } from './managed-pnpm-completeness';
import { pnpmManifestIdentity, type PnpmGraphFact } from './managed-pnpm-graph-facts';

// Pure protocol/graph metadata only. No fixture files, trees, archives, processes or SDK execution.
const integrity = (value: number) => `sha512-${Buffer.alloc(64, value).toString('base64')}`;
const root = (slot: number, name: string) => `.pnpm/${slot}/node_modules/${name}`;
function graph(windows = false) {
  const lock = {
    lockfileVersion: '9.0',
    settings: {},
    importers: {
      '.': {
        dependencies: { app: { specifier: '1.0.0', version: '1.0.0' } },
        devDependencies: { tool: { specifier: '1.0.0', version: '1.0.0' } },
        optionalDependencies: { native: { specifier: '1.0.0', version: '1.0.0' } },
      },
    },
    packages: Object.fromEntries(
      ['app', 'tool', 'shared', 'native'].map((name, index) => [
        `${name}@1.0.0`,
        { resolution: { integrity: integrity(index + 1) } },
      ]),
    ),
    snapshots: {
      'app@1.0.0': { dependencies: { shared: '1.0.0' } },
      'tool@1.0.0': { dependencies: { shared: '1.0.0' } },
      'shared@1.0.0': {},
      'native@1.0.0': { dependencies: { shared: '1.0.0' } },
    } as Record<string, unknown>,
  };
  const facts = new Map<string, PnpmGraphFact>(),
    nodes = new Map<string, PnpmInstalledNode>();
  function packageNodes(slot: number, name: string) {
    const path = root(slot, name),
      bins = name === 'tool' ? [{ command: 'tool', target: 'cli.js' }] : [];
    const manifest = pnpmManifestIdentity(
      Buffer.from(
        JSON.stringify({
          name,
          version: '1.0.0',
          ...(bins.length ? { bin: { tool: 'cli.js' } } : {}),
        }),
      ),
    );
    facts.set(manifest.id, { manifestDigest: manifest.digest, bins });
    nodes.set(path, { type: 'directory' });
    nodes.set(`${path}/package.json`, {
      type: 'file',
      digest: manifest.digest,
      manifestId: manifest.id,
    });
    if (bins.length) nodes.set(`${path}/cli.js`, { type: 'file', digest: 'a'.repeat(64) });
  }
  packageNodes(0, 'app');
  packageNodes(1, 'tool');
  packageNodes(2, 'shared');
  packageNodes(3, 'native');
  nodes.delete(root(3, 'native'));
  nodes.delete(`${root(3, 'native')}/package.json`);
  nodes.set('app', { type: 'link', target: root(0, 'app') });
  nodes.set('tool', { type: 'link', target: root(1, 'tool') });
  nodes.set('.pnpm/0/node_modules/shared', { type: 'link', target: root(2, 'shared') });
  nodes.set('.pnpm/1/node_modules/shared', { type: 'link', target: root(2, 'shared') });
  for (const suffix of windows ? ['', '.CMD', '.ps1'] : [''])
    nodes.set(`.bin/tool${suffix}`, {
      type: 'file',
      digest: 'b'.repeat(64),
      targets: [`${root(1, 'tool')}/cli.js`],
    });
  return { lock, facts, nodes, packageNodes };
}

it('requires both production and development graphs, allowing only absent optional branches', () => {
  const { lock, facts, nodes } = graph();
  nodes.set('.pnpm/lock.yaml', { type: 'file', digest: 'a'.repeat(64) });
  expect(assertPnpmInstalledGraph(lock, facts, nodes, false)).toEqual({
    snapshots: 3,
    links: 4,
    shims: 1,
  });
  for (const path of [
    'app',
    'tool',
    '.pnpm/0/node_modules/shared',
    '.pnpm/1/node_modules/shared',
  ]) {
    const missing = new Map(nodes);
    missing.delete(path);
    expect(() => assertPnpmInstalledGraph(lock, facts, missing, false)).toThrow(
      'required_dependency_missing',
    );
  }
});

it('rejects private-but-wrong targets, wrong versions, missing or changed archive manifests', () => {
  const { lock, facts, nodes } = graph();
  for (const node of [
    { type: 'link', target: root(2, 'shared') },
    { type: 'link', target: `${root(1, 'tool')}/cli.js` },
    { type: 'directory' },
  ] as PnpmInstalledNode[]) {
    const wrong = new Map(nodes);
    wrong.set('tool', node);
    expect(() => assertPnpmInstalledGraph(lock, facts, wrong, false)).toThrow(
      'managed_pnpm_graph_',
    );
  }
  for (const replacement of [
    undefined,
    { type: 'file', digest: facts.get('tool@1.0.0')!.manifestDigest, manifestId: 'tool@2.0.0' },
    { type: 'file', digest: '0'.repeat(64), manifestId: 'tool@1.0.0' },
  ] as (PnpmInstalledNode | undefined)[]) {
    const wrong = new Map(nodes),
      path = `${root(1, 'tool')}/package.json`;
    if (replacement) wrong.set(path, replacement);
    else wrong.delete(path);
    expect(() => assertPnpmInstalledGraph(lock, facts, wrong, false)).toThrow(
      'package_identity_changed',
    );
  }
});

it('binds peer-context multiplicity bijectively instead of accepting one base-version copy for two snapshots', () => {
  const { lock, facts, nodes, packageNodes } = graph();
  const peer = 'shared@1.0.0(peer@1.0.0)';
  lock.snapshots[peer] = {};
  lock.snapshots['tool@1.0.0'] = { dependencies: { shared: '1.0.0(peer@1.0.0)' } };
  expect(() => assertPnpmInstalledGraph(lock, facts, nodes, false)).toThrow('peer_context_changed');
  packageNodes(4, 'shared');
  nodes.set('.pnpm/1/node_modules/shared', { type: 'link', target: root(4, 'shared') });
  expect(assertPnpmInstalledGraph(lock, facts, nodes, false).snapshots).toBe(4);
});

it('distinguishes scoped package roots from their physical @scope parent directories', () => {
  const { lock, facts, nodes, packageNodes } = graph();
  const scoped = '@scope/shared';
  lock.packages[`${scoped}@1.0.0`] = lock.packages['shared@1.0.0']!;
  delete lock.packages['shared@1.0.0'];
  delete lock.snapshots['shared@1.0.0'];
  lock.snapshots[`${scoped}@1.0.0`] = {};
  for (const id of ['app@1.0.0', 'tool@1.0.0', 'native@1.0.0'])
    lock.snapshots[id] = { dependencies: { [scoped]: '1.0.0' } };
  facts.delete('shared@1.0.0');
  nodes.delete(root(2, 'shared'));
  nodes.delete(`${root(2, 'shared')}/package.json`);
  packageNodes(2, scoped);
  for (const slot of [0, 1, 2])
    nodes.set(`.pnpm/${slot}/node_modules/@scope`, { type: 'directory' });
  for (const slot of [0, 1]) {
    nodes.delete(`.pnpm/${slot}/node_modules/shared`);
    nodes.set(`.pnpm/${slot}/node_modules/${scoped}`, { type: 'link', target: root(2, scoped) });
  }
  expect(assertPnpmInstalledGraph(lock, facts, nodes, false).snapshots).toBe(3);
  nodes.set('.pnpm/0/node_modules/@scope/shared.js', { type: 'file', digest: 'a'.repeat(64) });
  expect(() => assertPnpmInstalledGraph(lock, facts, nodes, false)).toThrow('resolution_shadow');
});

it('checks the required subtree of an optional package whenever that package is present', () => {
  const { lock, facts, nodes, packageNodes } = graph();
  packageNodes(3, 'native');
  nodes.set('native', { type: 'link', target: root(3, 'native') });
  expect(() => assertPnpmInstalledGraph(lock, facts, nodes, false)).toThrow(
    'required_dependency_missing',
  );
  nodes.set('.pnpm/3/node_modules/shared', { type: 'link', target: root(2, 'shared') });
  expect(assertPnpmInstalledGraph(lock, facts, nodes, false).snapshots).toBe(4);
});

it('requires every Windows shim suffix and the archive-bound provider target, not merely any private reference', () => {
  const { lock, facts, nodes } = graph(true);
  expect(assertPnpmInstalledGraph(lock, facts, nodes, true).shims).toBe(3);
  for (const path of ['.bin/tool', '.bin/tool.CMD', '.bin/tool.ps1']) {
    const missing = new Map(nodes);
    missing.delete(path);
    expect(() => assertPnpmInstalledGraph(lock, facts, missing, true)).toThrow(
      'bin_missing_or_changed',
    );
  }
  const wrong = new Map(nodes);
  wrong.set('.bin/tool.CMD', {
    type: 'file',
    digest: 'b'.repeat(64),
    targets: [`${root(0, 'app')}/package.json`],
  });
  expect(() => assertPnpmInstalledGraph(lock, facts, wrong, true)).toThrow(
    'bin_missing_or_changed',
  );
  const removedBin = new Map(nodes);
  removedBin.delete(`${root(1, 'tool')}/cli.js`);
  expect(() => assertPnpmInstalledGraph(lock, facts, removedBin, true)).toThrow(
    'bin_target_missing',
  );
});

it('requires executable shims in each dependency consumer scope, not only the importer', () => {
  const { lock, facts, nodes } = graph();
  lock.snapshots['app@1.0.0'] = { dependencies: { shared: '1.0.0', tool: '1.0.0' } };
  nodes.set('.pnpm/0/node_modules/tool', { type: 'link', target: root(1, 'tool') });
  expect(() => assertPnpmInstalledGraph(lock, facts, nodes, false)).toThrow(
    'bin_missing_or_changed',
  );
  nodes.set(`${root(0, 'app')}/node_modules/.bin/tool`, {
    type: 'file',
    digest: 'b'.repeat(64),
    targets: [`${root(1, 'tool')}/cli.js`],
  });
  expect(assertPnpmInstalledGraph(lock, facts, nodes, false).shims).toBe(2);
});

it('permits only an exact graph-bound same-name dependency link in the nested resolution scope', () => {
  const { lock, facts, nodes } = graph();
  lock.snapshots['app@1.0.0'] = { dependencies: { app: '1.0.0', shared: '1.0.0' } };
  nodes.set(`${root(0, 'app')}/node_modules`, { type: 'directory' });
  nodes.set(`${root(0, 'app')}/node_modules/app`, { type: 'link', target: root(0, 'app') });
  expect(assertPnpmInstalledGraph(lock, facts, nodes, false).links).toBe(5);
});

it('rejects physical nested packages and file-extension shadows ahead of valid dependency links', () => {
  const { lock, facts, nodes } = graph();
  for (const path of [
    `${root(0, 'app')}/node_modules/shared`,
    `${root(0, 'app')}/node_modules/shared.js`,
    `${root(0, 'app')}/node_modules/@scope/shared`,
    `${root(0, 'app')}/lib/node_modules/shared`,
    'app.js',
    'app.json',
    'app.node',
    '.pnpm/0/node_modules/shared.js',
    '.pnpm/0/node_modules/shared.json',
    '.pnpm/0/node_modules/shared.node',
    '.pnpm/node_modules/shared',
    '.pnpm/node_modules/shared.js',
    '.pnpm/node_modules/shared/package.json',
    '.pnpm/node_modules/shared/index.js',
    '.pnpm/unbound/node_modules/shared/package.json',
  ]) {
    const shadow = new Map(nodes);
    shadow.set(
      path,
      path.endsWith('shared') ? { type: 'directory' } : { type: 'file', digest: 'a'.repeat(64) },
    );
    expect(() => assertPnpmInstalledGraph(lock, facts, shadow, false)).toThrow('resolution_shadow');
  }
});

it('rejects unbound links, packages and bins, and fails closed without trusted required package facts', () => {
  const { lock, facts, nodes, packageNodes } = graph();
  const extraLink = new Map(nodes);
  extraLink.set('unknown', { type: 'link', target: root(0, 'app') });
  expect(() => assertPnpmInstalledGraph(lock, facts, extraLink, false)).toThrow('unexpected_link');
  const extraBin = new Map(nodes);
  extraBin.set('.bin/extra', { type: 'file', digest: 'a'.repeat(64) });
  expect(() => assertPnpmInstalledGraph(lock, facts, extraBin, false)).toThrow('unexpected_bin');
  const missingFact = new Map(facts);
  missingFact.delete('tool@1.0.0');
  expect(() => assertPnpmInstalledGraph(lock, missingFact, nodes, false)).toThrow(
    'package_identity_changed',
  );
  packageNodes(4, 'shared');
  expect(() => assertPnpmInstalledGraph(lock, facts, nodes, false)).toThrow('unexpected_package');
});
