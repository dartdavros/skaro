import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMarkdown, serializeMarkdown, setFields, type Task } from '@skaro/core';
import type { TaskReplanDecision } from './task-replan-journal';

export async function taskFiles(root: string, tasks: Task[]): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      tasks.map(async (task) => [task.id, await readFile(join(root, task.path), 'utf8')]),
    ),
  );
}

/** Older journals kept the complete task model, but not the deleted file's formatting. */
export function restoredTaskText(task: Task, existing = ''): string {
  const file = parseMarkdown(existing);
  setFields(file, {
    id: task.id,
    title: task.title,
    milestone: task.milestone,
    status: task.status,
    depends_on: task.dependsOn,
    order: task.order,
    agent: task.agent,
    model: task.model,
    branch: task.branch,
    requires_pull_request: task.requiresPullRequest || undefined,
    spec: task.spec,
    created: task.created,
    unblocked: task.unblocked || undefined,
    archived: task.archived || undefined,
  });
  file.body = task.body;
  return serializeMarkdown(file);
}

/** Exact output of the normal writer for a new journal, even before its progress was saved. */
export function plannedTaskText(
  decision: TaskReplanDecision,
  write: TaskReplanDecision['writes'][number],
): string | undefined {
  if (write.before && !decision.beforeFiles?.[write.id]) return;
  const file = parseMarkdown(write.before ? decision.beforeFiles![write.id]! : '');
  const input = write.input;
  setFields(
    file,
    write.before
      ? {
          title: input.title,
          milestone: input.milestone,
          depends_on: input.dependsOn,
          order: input.order,
          spec: input.spec,
        }
      : {
          id: write.id,
          title: input.title,
          milestone: input.milestone,
          status: 'todo',
          depends_on: input.dependsOn ?? [],
          order: input.order,
          agent: input.agent,
          model: input.model,
          spec: input.spec,
          created: input.created,
        },
  );
  file.body = input.body!;
  return serializeMarkdown(file);
}
