import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { eventually } from './resource-workflow-observation';

const exec = promisify(execFile);
/** Exercise the actual scoped MCP fallback without asking the agent to violate its instructions. */
export async function isolationTool(s: Services, projectId: string, taskId: string, name: string) {
  const run = s.db.latestRun(projectId, taskId)!;
  const grant = s.mcp.grant({ kind: 'task', projectId, taskId, runId: run.id });
  try {
    const response = await fetch(grant.url, {
      method: 'POST',
      headers: {
        ...grant.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: {} },
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert(response.ok);
    const receipt = await response.json();
    assert(!receipt.error && !receipt.result.isError, JSON.stringify(receipt));
    assert(JSON.stringify(receipt.result).includes('No separate checkout is required'));
    return receipt.result;
  } finally {
    grant.revoke();
  }
}
export async function isolationContainers(name: string) {
  const { stdout } = await exec(
    'docker',
    ['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${name}`],
    { windowsHide: true, timeout: 20000 },
  );
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  const result = await exec('docker', ['inspect', ...ids], { windowsHide: true, timeout: 20000 });
  return (
    JSON.parse(result.stdout) as {
      Id: string;
      Created: string;
      State: { Running: boolean; StartedAt: string };
      Mounts: { Source: string; Destination: string; RW: boolean }[];
    }[]
  ).map(({ Id, Created, State, Mounts }) => ({
    Id,
    Created,
    State: { Running: State.Running, StartedAt: State.StartedAt },
    Mounts,
  }));
}

export async function isolationFiles(root: string) {
  const paths = (
    await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  ).stdout
    .split('\0')
    .filter(Boolean)
    .sort();
  const hashes: Record<string, string> = {};
  for (const path of paths)
    hashes[path] = createHash('sha256')
      .update(await readFile(join(root, path)))
      .digest('hex');
  return { root, head: (await git(root, ['rev-parse', 'HEAD'])).stdout.trim(), hashes };
}

export async function isolationTask(s: Services, project: string, task: string) {
  const view = await s.runs.open(project, task);
  const items = view.timeline?.items ?? [];
  return {
    view,
    commands: items.filter((i) => i.kind === 'command'),
    tools: items.filter((i) => i.kind === 'tool'),
    errors: items.filter((i) => i.kind === 'notice' && i.level === 'error'),
  };
}

export async function waitIsolationTurn(s: Services, project: string, task: string) {
  const observed = await eventually(
    () => isolationTask(s, project, task),
    (o) => !!o.view.timeline?.turns.at(-1)?.outcome,
    'bounded real agent inspection',
    300000,
  );
  assert.equal(
    observed.view.timeline?.turns.at(-1)?.outcome,
    'done',
    JSON.stringify(observed.errors),
  );
  return observed;
}
