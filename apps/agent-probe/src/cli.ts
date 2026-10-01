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
import { ClaudeProjector } from '@skaro/adapter-claude';
import { CodexProjector } from '@skaro/adapter-codex';
import { replayRawLog } from '@skaro/timeline';
import { checkAdapters, type Agent } from './adapters.ts';
import { describe } from './describe.ts';
import { createSanitizer, sanitizeJsonl } from './recorder.ts';
import { scenarios } from './scenarios.ts';
import { recordScenario } from './record.ts';

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
  for (const scenario of selected) {
    const result = await recordScenario(agent, scenario, {
      out: values.out ?? GOLDEN,
      model: values.model,
      effort: values.effort,
      codexConfig: values['codex-config'],
      overwrite: true,
    });
    if (result.error) process.exitCode = 1;
  }
}

await main();
