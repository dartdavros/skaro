// A milestone only groups tasks on the plan. A request to merge it merges its accepted tasks
// one by one, dependencies first; each merge is the Git operation of that task alone.

import type { CompletionHooks } from './completion-coordinator';
import { CompletionStore } from './completion-store';
import { publicationBlockers } from './completion-dependencies';
import { returnedToAgent } from './completion-monitor';

interface Merged {
  commit: string;
  base: string;
}

export async function mergeCompletionTarget(
  hooks: CompletionHooks,
  projectId: string,
  target: string,
  mergeTask: (id: string, message?: string) => Promise<Merged>,
  message?: string,
): Promise<Merged> {
  const context = hooks.deps.projects.get(projectId);
  context.invalidate();
  if ((await context.load()).tasks.some((item) => item.id === target))
    return mergeTask(target, message);
  return mergeMilestoneTasks(hooks, projectId, target, mergeTask, message);
}

export async function mergeMilestoneTasks(
  hooks: CompletionHooks,
  projectId: string,
  milestone: string,
  mergeTask: (taskId: string, message?: string) => Promise<Merged>,
  message?: string,
): Promise<Merged> {
  const context = hooks.deps.projects.get(projectId);
  const load = async () => {
    context.invalidate();
    return context.load();
  };
  const scope = (await load()).tasks.filter(
    (item) => item.milestone === milestone && !item.archived && item.status !== 'cancelled',
  );
  if (!scope.length) throw new Error(`No tasks to merge: ${milestone}`);
  const own = (id: string) => scope.some((item) => item.id === id);
  const store = new CompletionStore(hooks.deps.db, projectId);
  let merged: Merged | undefined;
  let returned: string | undefined;
  const tried = new Set<string>();
  for (;;) {
    const current = await load();
    const next = current.tasks.find(
      (task) =>
        own(task.id) &&
        task.status === 'review' &&
        !tried.has(task.id) &&
        !publicationBlockers(current, [store.result(task.id) ?? { taskId: task.id }]).length,
    );
    if (!next) break;
    tried.add(next.id);
    try {
      merged = await mergeTask(next.id);
    } catch (error) {
      if (!(await returnedToAgent(hooks, projectId, next.id, error))) throw error;
      // One conflict at a time: the rest is merged onto what its agent hands back.
      returned = next.id;
      break;
    }
  }
  if (merged) return merged;
  if (returned) throw new Error(`${returned}: the merge conflict went back to the task agent`);
  const left = (await load()).tasks.filter((task) => own(task.id) && task.status === 'review');
  // A repeated request for a milestone whose tasks are all merged answers with its last merge.
  const last = store
    .operations()
    .findLast((op) => op.state === 'completed' && op.results.some((r) => own(r.taskId)));
  if (!left.length && last?.commit) return { commit: last.commit, base: last.base };
  // Nothing could be merged: the first accepted task says what holds it.
  return mergeTask((left[0] ?? scope[0]!).id, message);
}
