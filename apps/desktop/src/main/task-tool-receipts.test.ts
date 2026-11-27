import { AppDb } from '@skaro/core';
import { emptyTimeline } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { executeTaskTool } from './task-tool-receipts';
import { TaskExecution } from './task-execution';
import { resumeTaskExecution } from './task-resume';

it('replaying a task tool after Stop returns its receipt without renewing execution', async () => {
  const db = AppDb.open(':memory:');
  try {
    const scope = { kind: 'task' as const, projectId: 'p', taskId: 'T-038', runId: 'run' };
    const execution = new TaskExecution(db, scope.runId);
    const args = { command_id: 'answers-1', instruction: 'Доделать' };
    execution.followUp(args.command_id, args.instruction);
    const resume = () =>
      Promise.resolve(
        resumeTaskExecution(execution, emptyTimeline(), args.command_id, args.instruction),
      );
    const send = () => executeTaskTool(db, scope, 'resume_task', args, 'call-1', resume);
    expect((await send()).isError).toBeFalsy();
    execution.stop();
    expect((await send()).isError).toBeFalsy();
    expect(execution.read().enabled).toBe(false);
    await expect(
      executeTaskTool(db, scope, 'resume_task', { ...args, command_id: 'other' }, 'call-1', resume),
    ).rejects.toThrow('identity changed');
  } finally {
    db.close();
  }
});
