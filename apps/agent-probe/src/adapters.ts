import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAdapter } from '@skaro/adapter-claude';
import { CodexAdapter, type CodexBinary } from '@skaro/adapter-codex';
import type { AgentAdapter } from '@skaro/timeline';

export type Agent = 'claude' | 'codex';

const CODEX_TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
};

/** Pinned Claude Code binary from the SDK platform package installed for the probe. */
export function claudeBinary(): string {
  const sdk = fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'));
  const pkg = createRequire(sdk).resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
  );
  return join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude');
}

/** Pinned Codex binary from the @openai/codex platform package, as its launcher finds it. */
export function codexBinary(): CodexBinary {
  const key = `${process.platform}-${process.arch}`;
  const triple = CODEX_TRIPLES[key];
  if (!triple) throw new Error(`unsupported platform ${key}`);
  const launcher = createRequire(import.meta.url).resolve('@openai/codex/package.json');
  const platformPkg = createRequire(launcher).resolve(`@openai/codex-${key}/package.json`);
  const vendor = join(dirname(platformPkg), 'vendor', triple);
  return {
    binary: join(vendor, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    pathDirs: [join(vendor, 'codex-path')],
  };
}

export interface AdapterSetup {
  /** Empty config dir: reproduces "not logged in". */
  authMissing?: boolean;
  /** Codex `-c key=value` overrides. */
  codexConfig?: string[];
}

export function createAdapter(agent: Agent, setup: AdapterSetup = {}): AgentAdapter {
  const noAuth = setup.authMissing ? mkdtempSync(join(tmpdir(), 'skaro-probe-noauth-')) : undefined;
  if (agent === 'claude') {
    return new ClaudeAdapter({
      executable: async () => claudeBinary(),
      ...(noAuth ? { configDir: noAuth } : {}),
    });
  }
  return new CodexAdapter({
    binary: async () => codexBinary(),
    openUrl: (url) => console.log(`open ${url}`),
    ...(noAuth ? { codexHome: noAuth } : {}),
    ...(setup.codexConfig ? { config: setup.codexConfig } : {}),
  });
}

/** Everything an adapter can tell without a model call. */
export async function checkAdapters(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'skaro-adapters-'));
  try {
    for (const agent of ['claude', 'codex'] as const) {
      const adapter = createAdapter(agent);
      console.log(`\n=== ${adapter.id} (adapter ${adapter.adapterVersion})`);
      const status = await adapter.status();
      console.log(
        'status:',
        JSON.stringify({ ...status, account: status.account ? '<set>' : undefined }),
      );
      for (const m of await adapter.listModels(scratch)) {
        const efforts = m.efforts.map((e) => e.id).join('/') || '-';
        console.log(
          `model: ${m.id} — ${m.name}${m.isDefault ? ' (default)' : ''}; effort: ${efforts}${m.defaultEffort ? ` [${m.defaultEffort}]` : ''}; images: ${m.images}`,
        );
      }
      const commands = await adapter.listCommands(scratch);
      console.log(
        `commands: ${commands.length} (${commands.filter((c) => c.kind === 'skill').length} skills), e.g. ${commands
          .slice(0, 5)
          .map((c) => c.name)
          .join(', ')}`,
      );
      const t = Date.now();
      console.log(
        'sandbox:',
        JSON.stringify(await adapter.checkSandbox(scratch)),
        `${Date.now() - t} ms`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
