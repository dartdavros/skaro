import type { AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';
import { detail } from './task-run-helpers';
import { taskResourceWait } from './resource-wait-view';
import { currentTransition } from './task-lifecycle-journal';
import { taskEnvironmentRetry } from './task-environment-retry-view';

/** The control panel must be readable even when no session or conversation can be restored. */
export async function taskControlView(db: AppDb, project: ProjectContext, taskId: string) {
  let transition = currentTransition(db, project.id, taskId);
  let artifacts = await project.summary();
  while (transition?.revision !== currentTransition(db, project.id, taskId)?.revision) {
    transition = currentTransition(db, project.id, taskId);
    artifacts = await project.summary();
  }
  const task = artifacts.tasks.find((item) => item.id === taskId);
  if (!task) return undefined; // Milestone acceptance has its own panel.
  const runtime = db.getTaskRuntime(project.id);
  const run = db.latestRun(project.id, taskId);
  return {
    ...taskEnvironmentRetry(
      db,
      taskResourceWait(db, project.id, detail(task, artifacts, runtime, run)),
      run,
      runtime.get(taskId)?.state,
    ),
    lifecyclePending: !!transition && transition.phase !== 'settled',
    lifecycleRevision: transition?.revision ?? 0,
  };
}
