// Downloads pinned agent binaries on first use (agent-output.md, 9.1): the npm tarball of the
// platform package, verified against the registry's sha512 integrity, unpacked into
// <app data>/agents/<agent>/<version>/.

import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extract } from 'tar';
import { agentPackage, type AgentId, type AgentPackage, type Platform } from './pins.ts';

export interface InstalledAgent {
  agent: AgentId;
  version: string;
  dir: string;
  binary: string;
  pathDirs: string[];
}

export interface InstallerOptions {
  /** <app data>/agents */
  dir: string;
  registry?: string;
  fetch?: typeof fetch;
  platform?: Platform;
}

export type InstallProgress = (received: number, total: number | undefined) => void;

const MARKER = '.skaro-installed.json';

export class AgentInstaller {
  private readonly dir: string;
  private readonly registry: string;
  private readonly fetch: typeof fetch;
  private readonly platform: Platform | undefined;

  constructor(options: InstallerOptions) {
    this.dir = options.dir;
    this.registry = (options.registry ?? 'https://registry.npmjs.org').replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
    this.platform = options.platform;
  }

  package(agent: AgentId): AgentPackage {
    return agentPackage(agent, this.platform);
  }

  /** The pinned version if it is fully installed. */
  async installed(agent: AgentId): Promise<InstalledAgent | undefined> {
    const pkg = this.package(agent);
    const dir = this.versionDir(pkg);
    try {
      JSON.parse(await readFile(join(dir, MARKER), 'utf8'));
    } catch {
      return undefined;
    }
    const agentInfo = this.describe(pkg, dir);
    return existsSync(agentInfo.binary) ? agentInfo : undefined;
  }

  /** Installs the pinned version (no-op if present). Safe to interrupt: partial downloads are discarded. */
  async install(
    agent: AgentId,
    onProgress?: InstallProgress,
    signal?: AbortSignal,
  ): Promise<InstalledAgent> {
    const existing = await this.installed(agent);
    if (existing) return existing;

    const pkg = this.package(agent);
    const meta = await this.json(
      `${this.registry}/${encodePackage(pkg.name)}/${encodeURIComponent(pkg.npmVersion)}`,
      signal,
    );
    const dist = meta['dist'] as { tarball?: string; integrity?: string } | undefined;
    if (!dist?.tarball || !dist.integrity?.startsWith('sha512-')) {
      throw new Error(
        `${pkg.name}@${pkg.npmVersion}: registry has no tarball with sha512 integrity`,
      );
    }

    await mkdir(this.dir, { recursive: true });
    const staging = join(this.dir, `.staging-${randomUUID()}`);
    const tarball = `${staging}.tgz`;
    try {
      const digest = await this.download(dist.tarball, tarball, onProgress, signal);
      if (`sha512-${digest}` !== dist.integrity) {
        throw new Error(`${pkg.name}@${pkg.npmVersion}: integrity check failed`);
      }
      await mkdir(staging, { recursive: true });
      await extract({ file: tarball, cwd: staging, strip: 1 });
      const binary = join(staging, pkg.binary);
      if (!existsSync(binary))
        throw new Error(`${pkg.name}@${pkg.npmVersion}: ${pkg.binary} not found in package`);
      if (process.platform !== 'win32') await chmod(binary, 0o755);
      await writeFile(
        join(staging, MARKER),
        JSON.stringify({
          name: pkg.name,
          version: pkg.npmVersion,
          integrity: dist.integrity,
          installedAt: new Date().toISOString(),
        }),
      );
      const target = this.versionDir(pkg);
      await rm(target, { recursive: true, force: true });
      await mkdir(join(this.dir, agent), { recursive: true });
      await rename(staging, target);
      return this.describe(pkg, target);
    } finally {
      await rm(tarball, { force: true });
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Deletes versions other than the pinned one (after a Skaro update). */
  async removeOldVersions(agent: AgentId): Promise<string[]> {
    const keep = this.package(agent).version;
    const root = join(this.dir, agent);
    const removed: string[] = [];
    for (const name of await readdir(root).catch(() => [] as string[])) {
      if (name === keep) continue;
      await rm(join(root, name), { recursive: true, force: true });
      removed.push(name);
    }
    return removed;
  }

  private versionDir(pkg: AgentPackage): string {
    return join(this.dir, pkg.agent, pkg.version);
  }

  private describe(pkg: AgentPackage, dir: string): InstalledAgent {
    return {
      agent: pkg.agent,
      version: pkg.version,
      dir,
      binary: join(dir, pkg.binary),
      pathDirs: pkg.pathDirs.map((d) => join(dir, d)),
    };
  }

  private async json(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.fetch(url, { signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  /** Streams to `path`, returns the base64 sha512 of the bytes. */
  private async download(
    url: string,
    path: string,
    onProgress?: InstallProgress,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.fetch(url, { signal });
    if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || undefined;
    const hash = createHash('sha512');
    const out = createWriteStream(path);
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk))
          await new Promise<void>((resolve) => out.once('drain', () => resolve()));
        onProgress?.(received, total);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        out.end((error?: Error | null) => (error ? reject(error) : resolve())),
      );
    }
    if (total !== undefined && received !== total) throw new Error(`${url}: download incomplete`);
    return hash.digest('base64');
  }
}

/** `@scope/name` → `@scope%2fname` for registry URLs. */
function encodePackage(name: string): string {
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}
