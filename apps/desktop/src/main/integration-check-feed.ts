import type { Item } from '@skaro/timeline';
import type { IntegrationOperation } from './integration-model';
import type { IntegrationHistory } from './integration-history';

type CheckRun = NonNullable<IntegrationOperation['checkRuns']>[number];

/**
 * A check Skaro runs on the candidate, as the feed shows any command: the check name under the
 * command, live output, exit code and duration. Its place in checkRuns keeps the row stable.
 */
export function checkItem(
  op: IntegrationOperation,
  run: CheckRun,
  index: number,
  startedAt: number,
  endedAt?: number,
): Item {
  const exit =
    run.state === 'passed' ? 0 : /exit (\d+)$/.exec(run.error?.split('\n')[0] ?? '')?.[1];
  return {
    id: `skaro-check-${op.id}-${index}`,
    turnId: '',
    kind: 'command',
    command: run.run,
    description: run.name,
    output: run.output ?? '',
    outputLive: run.state === 'running',
    ...(exit !== undefined ? { exitCode: Number(exit) } : {}),
    ...(endedAt ? { durationMs: endedAt - startedAt, endedAt } : {}),
    status: run.state === 'running' ? 'running' : run.state === 'passed' ? 'done' : 'failed',
    startedAt,
    native: { agent: 'skaro', type: 'verification', ref: op.id },
  };
}

/** Skaro starts the candidate's services itself: the feed shows it as the agent's start does. */
export async function showEnvironmentStart<T>(
  history: Pick<IntegrationHistory, 'event'>,
  op: IntegrationOperation,
  start: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const item = (status: Item['status'], output?: string): Item => ({
    id: `skaro-environment-${op.id}-${op.checkRuns?.length ?? 0}`,
    turnId: '',
    kind: 'tool',
    name: 'start_environment',
    server: 'skaro',
    ...(output ? { output } : {}),
    status,
    startedAt,
    ...(status === 'running' ? {} : { endedAt: Date.now() }),
    native: { agent: 'skaro', type: 'verification', ref: op.id },
  });
  await history.event(op, { t: 'item.upsert', item: item('running') });
  try {
    const result = await start();
    await history.event(op, { t: 'item.upsert', item: item('done') });
    return result;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await history.event(op, { t: 'item.upsert', item: item('failed', text) });
    throw error;
  }
}
