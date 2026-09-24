// Stage 1 probe: runs a scenario against Claude Code or Codex, records the raw stream and
// prints canonical timeline events. Replays recorded sessions through the adapters.
//
//   pnpm probe <claude|codex> <scenario|all> [--model M] [--effort E] [--out DIR] [--codex-config k=v]
//   pnpm probe replay <claude|codex> <scenario|all> [--update]
//   pnpm probe adapters             (status, models, commands, sandbox check; no model calls)
//   pnpm probe sanitize
//   pnpm probe list

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ClaudeProjector, CLAUDE_ADAPTER_VERSION } from '@skaro/adapter-claude';
import { CodexProjector, CODEX_ADAPTER_VERSION } from '@skaro/adapter-codex';
import { replayRawLog } from '@skaro/timeline';
import { rebuildGolden } from '@skaro/timeline/golden';
import { checkAdapters, createAdapter, type Agent } from './adapters.ts';
import { describe } from './describe.ts';
import { createSanitizer, Recorder, sanitizeJsonl } from './recorder.ts';
import { scenarios, type Scenario } from './scenarios.ts';
import { ProbeSession } from './session.ts';
import { createWorkspace } from './workspace.ts';

const GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/golden');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: 'string' },
    effort: { type: 'string' },
    out: { type: 'string' },
    update: { type: 'boolean' },
    'codex-config': { type: 'string', multiple: true },
  },
});

async function record(agent: Agent, scenario: Scenario): Promise<void> {
  const workspace = createWorkspace(`${agent}-${scenario.id}`);
  const dir = join(values.out ?? GOLDEN, agent, scenario.id);
  const rec = new Recorder(dir, workspace);
  console.log(`\n=== ${agent} / ${scenario.id}: ${scenario.title}\n    workspace ${workspace}`);

  const adapter = createAdapter(agent, {
    authMissing: scenario.authMissing,
    codexConfig: values['codex-config'],
  });
  const session = new ProbeSession(adapter, rec, {
    workspace,
    permission: scenario.permission,
    ...(values.model ? { model: values.model } : {}),
    ...(values.effort ? { effort: values.effort } : {}),
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
    console.log(`!!! ${error}`);
  } finally {
    await session.close();
  }
  // The raw log is sanitized as it is written; the projection is rebuilt from it (principle P2).
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
}

/** Rebuilds the canonical timeline from raw.jsonl (principle P2) and diffs it with canonical.jsonl. */
function replay(agent: Agent, id: string): boolean {
  const dir = join(GOLDEN, agent, id);
  const events = replayRawLog(
    readFileSync(join(dir, 'raw.jsonl'), 'utf8'),
    (ctx, emit) =>
      agent === 'claude' ? new ClaudeProjector(ctx, emit) : new CodexProjector(ctx, emit),
    sha256,
  );
  const expected = readFileSync(join(dir, 'canonical.jsonl'), 'utf8').split('\n').filter(Boolean);
  const actual = events.map((e) => JSON.stringify(e));
  const same = expected.length === actual.length && expected.every((line, i) => line === actual[i]);
  if (values.update && !same) {
    writeFileSync(join(dir, 'canonical.jsonl'), actual.map((line) => `${line}\n`).join(''));
    console.log(`${agent}/${id}: canonical.jsonl rebuilt (${actual.length} events)`);
    return true;
  }
  console.log(`${agent}/${id}: ${same ? 'same' : 'DIFFERENT'} (${actual.length} events)`);
  if (!same) for (const e of events) console.log(describe(e) ?? '');
  return same;
}

function sha256(base64: string): string {
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

async function main(): Promise<void> {
  const [command, ...rest] = positionals;
  if (command === 'list' || !command) {
    for (const s of scenarios)
      console.log(`${s.id.padEnd(20)} ${s.permission.padEnd(5)} ${s.title}`);
    return;
  }
  if (command === 'adapters') {
    await checkAdapters();
    return;
  }
  if (command === 'sanitize') {
    // Re-applies the sanitizer to already recorded fixtures.
    const sanitize = createSanitizer();
    for (const agent of ['claude', 'codex'] as const) {
      for (const s of scenarios) {
        for (const file of ['raw.jsonl', 'canonical.jsonl']) {
          const path = join(GOLDEN, agent, s.id, file);
          if (existsSync(path))
            writeFileSync(path, sanitizeJsonl(readFileSync(path, 'utf8'), sanitize));
        }
      }
    }
    return;
  }
  if (command === 'replay') {
    const [agent, id] = rest as [Agent, string];
    const ids =
      id === 'all'
        ? scenarios.map((s) => s.id).filter((i) => existsSync(join(GOLDEN, agent, i, 'raw.jsonl')))
        : [id];
    const ok = ids.map((i) => replay(agent, i)).every(Boolean);
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const agent = command as Agent;
  if (agent !== 'claude' && agent !== 'codex') throw new Error(`unknown agent ${agent}`);
  const [id] = rest;
  const selected = id === 'all' ? scenarios : scenarios.filter((s) => s.id === id);
  if (!selected.length) throw new Error(`unknown scenario ${id}`);
  for (const scenario of selected) await record(agent, scenario);
}

await main();
