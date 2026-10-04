import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AgentInstaller } from './installer.ts';
import { agentPackage } from './pins.ts';

// Authorized filesystem fixtures only. No binary is executed and no server/fetch is replaced.
const pkg = agentPackage('codex', { os: 'win32', arch: 'x64' });
let dir: string;
let installer: AgentInstaller;
let marker: string;
let binary: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-agent-marker-'));
  const installed = join(dir, pkg.agent, pkg.version);
  binary = join(installed, pkg.binary);
  marker = join(installed, '.skaro-installed.json');
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(binary, 'filesystem fixture; never executed');
  installer = new AgentInstaller({ dir, platform: { os: 'win32', arch: 'x64' } });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it('requires marker package/version and the requested release integrity', async () => {
  const identity = { name: pkg.name, version: pkg.npmVersion, integrity: 'sha512-current' };
  await writeFile(marker, JSON.stringify(identity));
  expect((await installer.installedPackage(pkg, identity.integrity))?.binary).toBe(binary);
  expect(await installer.installedPackage(pkg, 'sha512-other')).toBeUndefined();
  await writeFile(marker, JSON.stringify({ ...identity, version: 'wrong' }));
  expect(await installer.installedPackage(pkg)).toBeUndefined();
  await writeFile(marker, JSON.stringify({ ...identity, name: 'wrong' }));
  expect(await installer.installedPackage(pkg)).toBeUndefined();
});

it('rejects changed integrity for an installed pin before any download or overwrite', async () => {
  await writeFile(
    marker,
    JSON.stringify({ name: pkg.name, version: pkg.npmVersion, integrity: 'sha512-old' }),
  );
  const before = await readFile(marker, 'utf8');
  await expect(
    installer.installPackage(
      pkg,
      {
        tarball: 'https://registry.npmjs.org/@openai/codex/-/codex.tgz',
        integrity: 'sha512-new',
      },
      undefined,
      AbortSignal.abort(),
    ),
  ).rejects.toThrow('installed integrity differs');
  expect(await readFile(marker, 'utf8')).toBe(before);
  expect(await readFile(binary, 'utf8')).toBe('filesystem fixture; never executed');
});
