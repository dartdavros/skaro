import { expect, it } from 'vitest';
import { taskLifecycleTools } from './task-lifecycle-tools.ts';
import type { SkaroScope } from './tools.ts';

it('exposes task lifecycle changes to project chat and rejects malformed targets and states', async () => {
  const unexpected = async () => {
    throw new Error('An invalid call reached the mutation handler');
  };
  const [remove, setStatus] = taskLifecycleTools({ delete: unexpected, setStatus: unexpected });
  const scope: SkaroScope = { kind: 'project_chat', projectId: 'p', chatId: 'c' };
  for (const tool of [remove!, setStatus!]) {
    expect(tool.available?.(scope)).toBe(true);
    expect(tool.available?.({ ...scope, importId: 'i' })).toBe(false);
    expect(tool.available?.({ kind: 'task', projectId: 'p', taskId: 'T-019' })).toBe(false);
  }
  await expect(remove!.call({ task_id: 'M01' }, scope)).resolves.toMatchObject({ isError: true });
  await expect(
    setStatus!.call({ task_id: 'T-019', status: 'queued' }, scope),
  ).resolves.toMatchObject({ isError: true });
});
