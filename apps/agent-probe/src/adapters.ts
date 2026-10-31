import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentDefinition, probeAgentId, PROBE_AGENTS, type ProbeAgent } from '@skaro/agents';

export type Agent = ProbeAgent;
export interface AdapterSetup {
  authMissing?: boolean;
  codexConfig?: string[];
}

export async function probeBinary(agent: string) {
  const runtime = await agentDefinition(probeAgentId(agent)).loadRuntime();
  return runtime.probeBinary(createRequire(import.meta.url).resolve);
}

export async function createAdapter(agent: Agent, setup: AdapterSetup = {}) {
  const definition = agentDefinition(probeAgentId(agent));
  const runtime = await definition.loadRuntime();
  const binary = await probeBinary(agent);
  const noAuth = setup.authMissing ? mkdtempSync(join(tmpdir(), 'skaro-probe-noauth-')) : undefined;
  return runtime.createAdapter(
    {
      installed: async () => binary,
      authRevision: new SharedArrayBuffer(4),
      openUrl: (url) => console.log(`open ${url}`),
    },
    { configDir: noAuth, nativeConfig: setup.codexConfig },
  );
}

/** Everything an adapter can tell without a model call. */
export async function checkAdapters(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'skaro-adapters-'));
  try {
    for (const agent of PROBE_AGENTS) {
      const adapter = await createAdapter(agent);
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
