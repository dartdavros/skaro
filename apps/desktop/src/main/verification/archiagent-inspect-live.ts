import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { measureResourceBudget } from '../resource-budget';
import { applicationResourcePolicy } from '../resource-policy';
import type { LocalVersionTarget } from '../../shared/local-versions';
import { git } from '@skaro/core';

export async function inspectArchiagent(s: Services, project: string, data: string) {
  const context = s.projects.get(project),
    artifacts = await context.load();
  const handlers = sessionHandlers(s);
  const environments = [];
  for (const taskId of ['T-005', 'T-010', 'T-011']) {
    try {
      const description = await s.runs['engine'].environments.describe({
        projectId: project,
        taskId,
      });
      environments.push({ taskId, description });
    } catch (error) {
      environments.push({ taskId, error: String(error) });
    }
  }
  return {
    activation: await handlers['archiagent.status'](project),
    tasks: artifacts.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dependsOn: t.dependsOn,
      unblocked: t.unblocked,
      spec: t.spec,
      body: t.body,
    })),
    runs: s.db.listRuns(project, undefined, { includeRetired: true }),
    decisions: await handlers['decisions.list'](project),
    environments,
    localTargets: s.db.collections.all<LocalVersionTarget>(`coordination.local-targets.${project}`),
    resources: s.db.resources.list(project),
    pendingOperations: s.db.coordination.pending(project),
    budget: await measureResourceBudget(applicationResourcePolicy(s.db), [data, context.root]),
    process: { memory: process.memoryUsage(), cpu: process.cpuUsage() },
    worktrees: (await git(context.root, ['worktree', 'list', '--porcelain'])).stdout,
    c4Problems: artifacts.c4Problems ?? [],
    artifactProblems: artifacts.problems,
  };
}
