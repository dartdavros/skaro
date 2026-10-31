import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { AgentHost, AgentRuntime } from '@skaro/timeline';
import { CodexAdapter } from './adapter.ts';
import { CodexAuthRevision } from './session-auth.ts';
import { codexDefinition } from './definition.ts';

export function createAdapter(
  host: AgentHost,
  options?: { configDir?: string; nativeConfig?: string[] },
): CodexAdapter {
  return new CodexAdapter({
    binary: host.installed,
    openUrl: host.openUrl,
    authRevision: new CodexAuthRevision(host.authRevision),
    ...(options?.configDir ? { codexHome: options.configDir } : {}),
    ...(options?.nativeConfig ? { config: options.nativeConfig } : {}),
  });
}

export const probeBinary: AgentRuntime['probeBinary'] = (resolvePackage) => {
  const launcher = resolvePackage('@openai/codex/package.json');
  const pkg = createRequire(launcher).resolve(
    `@openai/codex-${process.platform}-${process.arch}/package.json`,
  );
  const distribution = codexDefinition.distribution(
    { os: process.platform, arch: process.arch },
    codexDefinition.pin,
  );
  return {
    binary: join(dirname(pkg), distribution.binary),
    pathDirs: distribution.pathDirs.map((dir) => join(dirname(pkg), dir)),
  };
};

export function configDir(): string {
  return process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
}
