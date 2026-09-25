import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInstaller } from './installer.ts';
import { agentPackage, currentPlatform } from './pins.ts';

const WIN = { os: 'win32' as const, arch: 'x64' };
const LINUX = { os: 'linux' as const, arch: 'x64' };

let dir: string;
let server: Server;
let registry: string;
let tarball: Buffer;
let integrity: string;
let requests: string[];

/** An npm-style tarball: files under package/. */
async function makeTarball(files: Record<string, string>): Promise<Buffer> {
  const src = join(dir, `src-${Math.random()}`);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(src, 'package', path, '..'), { recursive: true });
    await writeFile(join(src, 'package', path), content);
  }
  const out = join(dir, `pkg-${Math.random()}.tgz`);
  await create({ gzip: true, file: out, cwd: src }, ['package']);
  return readFile(out);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-install-'));
  requests = [];
  tarball = await makeTarball({ 'claude.exe': 'fake binary', 'package.json': '{}' });
  integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url?.endsWith('.tgz')) {
      res.writeHead(200, { 'content-length': tarball.length });
      res.end(tarball);
    } else if (req.url?.startsWith('/@anthropic-ai%2Fclaude-agent-sdk-win32-x64/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ dist: { tarball: `${registry}/claude.tgz`, integrity } }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

describe('agent packages', () => {
  it('maps agents to platform packages', () => {
    expect(agentPackage('claude-code', WIN)).toMatchObject({
      name: '@anthropic-ai/claude-agent-sdk-win32-x64',
      npmVersion: '0.3.281',
      binary: 'claude.exe',
    });
    expect(agentPackage('claude-code', { ...LINUX, musl: true }).name).toBe(
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    );
    expect(agentPackage('codex', { os: 'darwin', arch: 'arm64' })).toMatchObject({
      name: '@openai/codex',
      npmVersion: '0.156.1-darwin-arm64',
      binary: 'vendor/aarch64-apple-darwin/bin/codex',
      pathDirs: ['vendor/aarch64-apple-darwin/codex-path'],
    });
    expect(() => agentPackage('codex', { os: 'freebsd', arch: 'x64' })).toThrow('not available');
  });
});

describe('AgentInstaller', () => {
  it('downloads, verifies, unpacks and reports progress', async () => {
    const installer = new AgentInstaller({ dir: join(dir, 'agents'), registry, platform: WIN });
    expect(await installer.installed('claude-code')).toBeUndefined();

    const progress: [number, number | undefined][] = [];
    const agent = await installer.install('claude-code', (done, total) =>
      progress.push([done, total]),
    );

    expect(agent.binary).toBe(join(dir, 'agents', 'claude-code', '0.3.281', 'claude.exe'));
    expect(await readFile(agent.binary, 'utf8')).toBe('fake binary');
    expect(progress.at(-1)).toEqual([tarball.length, tarball.length]);
    expect(await installer.installed('claude-code')).toEqual(agent);
    expect(requests[0]).toBe('/@anthropic-ai%2Fclaude-agent-sdk-win32-x64/0.3.281');
  });

  it('does not download again when installed', async () => {
    const installer = new AgentInstaller({ dir: join(dir, 'agents'), registry, platform: WIN });
    await installer.install('claude-code');
    const count = requests.length;
    await installer.install('claude-code');
    expect(requests.length).toBe(count);
  });

  it('rejects a tarball that does not match the registry integrity and leaves nothing behind', async () => {
    integrity = `sha512-${createHash('sha512').update('something else').digest('base64')}`;
    const installer = new AgentInstaller({ dir: join(dir, 'agents'), registry, platform: WIN });
    await expect(installer.install('claude-code')).rejects.toThrow('integrity check failed');
    expect(await installer.installed('claude-code')).toBeUndefined();
    expect(existsSync(join(dir, 'agents', 'claude-code'))).toBe(false);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(join(dir, 'agents'))).toEqual([]);
  });

  it('fails when the package has no binary for the platform', async () => {
    tarball = await makeTarball({ 'README.md': 'no binary' });
    integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
    const installer = new AgentInstaller({ dir: join(dir, 'agents'), registry, platform: WIN });
    await expect(installer.install('claude-code')).rejects.toThrow('claude.exe not found');
  });

  it('reports registry errors', async () => {
    const installer = new AgentInstaller({ dir: join(dir, 'agents'), registry, platform: LINUX });
    await expect(installer.install('claude-code')).rejects.toThrow('HTTP 404');
  });

  it('removes versions other than the pinned one', async () => {
    const installer = new AgentInstaller({ dir: join(dir, 'agents'), registry, platform: WIN });
    await installer.install('claude-code');
    await mkdir(join(dir, 'agents', 'claude-code', '0.3.200'), { recursive: true });
    expect(await installer.removeOldVersions('claude-code')).toEqual(['0.3.200']);
    expect(await installer.installed('claude-code')).toBeDefined();
  });
});

describe('currentPlatform', () => {
  it('reads the process report at most once and without network handles', () => {
    const report = process.report as NodeJS.ProcessReport & { excludeNetwork?: boolean };
    const seen: (boolean | undefined)[] = [];
    const spy = vi.spyOn(report, 'getReport').mockImplementation(() => {
      seen.push(report.excludeNetwork);
      return { header: { glibcVersionRuntime: '2.39' } } as unknown as object;
    });
    try {
      currentPlatform();
      const platform = currentPlatform();
      expect(platform).toMatchObject({ os: process.platform, arch: process.arch });
      expect(seen.length).toBeLessThanOrEqual(1);
      expect(seen.every((excluded) => excluded === true)).toBe(true);
      if (process.platform !== 'linux') expect(seen).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
