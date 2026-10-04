import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeProjector, CLAUDE_ADAPTER_VERSION } from '@skaro/adapter-claude';
import { CodexProjector, CODEX_ADAPTER_VERSION } from '@skaro/adapter-codex';
import { rebuildGolden } from '@skaro/timeline/golden';
import { createAdapter, type Agent } from './adapters.ts';
import { Recorder } from './recorder.ts';
import type { Scenario } from './scenarios.ts';
import { ProbeSession } from './session.ts';
import { createWorkspace } from './workspace.ts';

export interface RecordOptions {
  out: string;
  model?: string;
  effort?: string;
  codexConfig?: string[];
  quiet?: boolean;
  overwrite?: boolean;
}

/** Records an actual pinned agent. Manual compatibility runs use fresh directories only. */
export async function recordScenario(agent: Agent, scenario: Scenario, options: RecordOptions) {
  const dir = join(options.out, agent, scenario.id);
  if (!options.overwrite && existsSync(dir)) throw new Error('Recording directory already exists');
  const workspace = createWorkspace(`${agent}-${scenario.id}`);
  const rec = new Recorder(dir, workspace, options.quiet);
  console.log(`\n=== ${agent} / ${scenario.id}: ${scenario.title}`);
  const adapter = createAdapter(agent, {
    authMissing: scenario.authMissing,
    codexConfig: options.codexConfig,
  });
  const session = new ProbeSession(adapter, rec, {
    workspace,
    permission: scenario.permission,
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(scenario.sandbox ? { sandboxVerified: true } : {}),
  });
  if (scenario.responder) session.responder = scenario.responder;
  const started = Date.now();
  let error: string | undefined;
  try {
    await session.start();
    await scenario.run(session);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      await session.close();
    } catch (e) {
      error ??= e instanceof Error ? e.message : String(e);
    }
  }
  rebuildGolden(dir, (ctx, emit) =>
    agent === 'claude' ? new ClaudeProjector(ctx, emit) : new CodexProjector(ctx, emit),
  );
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify(
      {
        agent,
        scenario: scenario.id,
        title: scenario.title,
        permission: scenario.permission,
        adapterVersion: agent === 'claude' ? CLAUDE_ADAPTER_VERSION : CODEX_ADAPTER_VERSION,
        recordedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error,
      },
      null,
      2,
    ) + '\n',
  );
  return { dir, workspace, error };
}
