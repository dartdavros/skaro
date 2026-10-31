import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { AgentHost, AgentRuntime } from '@skaro/timeline';
import { ClaudeAdapter } from './adapter.ts';

export function createAdapter(host: AgentHost, options?: { configDir?: string }): ClaudeAdapter {
  return new ClaudeAdapter({
    executable: async () => (await host.installed())?.binary,
    ...(options?.configDir ? { configDir: options.configDir } : {}),
  });
}

export const probeBinary: AgentRuntime['probeBinary'] = (resolvePackage) => {
  const sdk = resolvePackage('@anthropic-ai/claude-agent-sdk');
  const pkg = createRequire(sdk).resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
  );
  return {
    binary: join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude'),
    pathDirs: [],
  };
};

export function configDir(): string {
  return process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
}
