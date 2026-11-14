import type { TaskKey } from '@skaro/core';
import type { EnvironmentDeps } from './task-environments';
import { backgroundWork, environmentJob } from './background-work';

export type EnvironmentSchedule = <T>(key: TaskKey, action: () => Promise<T>) => Promise<T>;

/** Cleanup locks its owner only. Recheck liveness after waiting before any destructive action. */
export async function maintainEnvironments(
  deps: EnvironmentDeps,
  records: TaskKey[],
  starting: TaskKey | undefined,
  schedule: EnvironmentSchedule,
  destroy: (key: TaskKey) => Promise<string[]>,
  stop: (key: TaskKey) => Promise<void>,
) {
  const busy = (key: TaskKey) =>
    [...deps.busy(), ...(starting ? [starting] : [])].some(
      (owner) => owner.projectId === key.projectId && owner.taskId === key.taskId,
    );
  await Promise.all(
    records.map(async (record) => {
      if (busy(record)) return;
      await schedule(record, async () => {
        if (busy(record)) return;
        try {
          if (await deps.finished(record)) {
            const job = backgroundWork.start(...environmentJob(deps.db, record));
            try {
              const failures = await destroy(record);
              if (failures.length) backgroundWork.fail(job, failures.join('; '));
              else backgroundWork.finish(job);
            } catch (error) {
              backgroundWork.fail(job, String(error));
            }
          } else await stop(record);
        } catch {
          // The existing guards persist retained/failed outcomes for this owner.
        }
      });
    }),
  );
}
