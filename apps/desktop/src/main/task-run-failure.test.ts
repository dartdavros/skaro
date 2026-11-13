import { expect, it } from 'vitest';
import type { IntegrationOperation } from './integration-model';
import { recoverIntegrationStarts } from './integration-recovery';
import { db, projectId, taskId, projects, restartTaskEngine } from './task-run-test-support';

/** Closing the sessions alone takes close to the default five seconds of a test. */
const CLOSING = 20_000;

/** An idle task has no runtime row. */
const runtime = () => db.getTaskRuntime(projectId).get(taskId)?.state ?? 'idle';

it(
  'keeps task status after a failed turn and holds the error until the agent works',
  async () => {
    const ctx = await restartTaskEngine();
    try {
      const before = await projects.get(projectId).store.readTask(taskId);
      const active = (await ctx.history.restore(projectId, taskId))!;
      await ctx.events.onTurnCompleted(active, 'failed');
      expect((await projects.get(projectId).store.readTask(taskId)).status).toBe(before.status);
      expect(runtime()).toBe('failed');
      ctx.events.settleRuntime(active);
      expect(runtime()).toBe('failed');
      ctx.events.onEvent(active, { t: 'turn.started', turnId: 'next' });
      expect(runtime()).toBe('running');
    } finally {
      await ctx.sessions.close();
    }
  },
  CLOSING,
);

it(
  'never marks an accepted result as failed: not by a broken turn, not by its merge',
  async () => {
    const ctx = await restartTaskEngine();
    try {
      await projects.get(projectId).store.updateTask(taskId, { status: 'review' });
      projects.get(projectId).invalidate();
      const active = (await ctx.history.restore(projectId, taskId))!;
      // The agent hit its limit after the result was accepted.
      await ctx.events.onTurnCompleted(active, 'failed');
      expect(runtime()).toBe('idle');

      const merge = { projectId, taskId, purpose: 'publication' } as IntegrationOperation;
      for (const state of ['queued', 'running', 'failed'] as const) {
        ctx.integrations.setRuntime(merge, state);
        expect(runtime()).toBe('idle');
      }
      // A question of the merge is asked in the chat of the task: it waits for the answer.
      ctx.integrations.setRuntime(merge, 'waiting');
      expect(runtime()).toBe('waiting');
      // Preparing a task is its own work: a failure there is the task's.
      ctx.integrations.setRuntime({ ...merge, purpose: 'dependencies' }, 'failed');
      expect(runtime()).toBe('failed');

      // What an earlier version left on a task in review goes away on the next start.
      await recoverIntegrationStarts(ctx);
      expect(runtime()).toBe('idle');
    } finally {
      await ctx.sessions.close();
    }
  },
  CLOSING,
);
