// What a run works on: a task, or the acceptance of a stage. The acceptance of a milestone runs
// like a task named after the milestone: its criteria are the milestone's «Критерий готовности»,
// its branch and checkout are the stage's, and its merge is the merge of the stage.

import type { Milestone, ProjectArtifacts, Task, TaskPatch, TaskStatus } from '@skaro/core';
import type { ProjectContext } from './projects';
import { stageTasks } from './task-stage';
import { taskSections } from './task-body';

const READINESS = /^##\s+(критерий готовности|done when|definition of done)\s*$/i;
const LIST_ITEM = /^\s*[-*]\s+/;

/** A readiness criterion written as plain text becomes a list: every line is ticked on its own. */
export function readinessAsList(body: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => READINESS.test(line.replace(/\r$/, '')));
  if (start < 0) return body;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end]!)) end++;
  const section = lines.slice(start + 1, end);
  if (section.some((line) => LIST_ITEM.test(line))) return body;
  const items = section.map((line) => (line.trim() ? `- [ ] ${line.trim()}` : line));
  return [...lines.slice(0, start + 1), ...items, ...lines.slice(end)].join('\n');
}

const over = (task: Task) => task.status === 'done' || task.status === 'cancelled';
const finished = (task: Task) => task.status === 'review' || over(task);

/**
 * Where the acceptance of a stage stands. Nothing is stored: "done" when its tasks are merged,
 * "review" when they are all finished and every readiness criterion is ticked, "in progress"
 * while the acceptance has something to check.
 */
export function stageStatus(stage: Milestone, artifacts: ProjectArtifacts): TaskStatus {
  const tasks = stageTasks(stage, artifacts);
  if (!tasks.length || !tasks.every(finished)) return 'todo';
  if (tasks.every(over)) return 'done';
  const criteria = taskSections(readinessAsList(stage.body)).criteria;
  return criteria.every((c) => c.done) ? 'review' : 'in_progress';
}

/** The acceptance of a stage in the shape of a task. */
export function stageSubject(stage: Milestone, artifacts: ProjectArtifacts): Task {
  return {
    id: stage.id,
    title: stage.title,
    status: stageStatus(stage, artifacts),
    dependsOn: [],
    unblocked: false,
    archived: false,
    ...(stage.branch ? { branch: stage.branch } : {}),
    body: readinessAsList(stage.body),
    path: stage.path,
  };
}

/** The milestone a run id names; a task with the same id wins. */
export function subjectStage(artifacts: ProjectArtifacts, id: string): Milestone | undefined {
  if (artifacts.tasks.some((t) => t.id === id)) return undefined;
  return artifacts.milestones.find((m) => m.id === id);
}

export function subjectOf(artifacts: ProjectArtifacts, id: string): Task | undefined {
  const task = artifacts.tasks.find((t) => t.id === id);
  if (task) return task;
  const stage = artifacts.milestones.find((m) => m.id === id);
  return stage ? stageSubject(stage, artifacts) : undefined;
}

/** The task as its file says now; an id that names no task is the acceptance of a stage. */
export async function readSubject(context: ProjectContext, id: string): Promise<Task> {
  try {
    return await context.store.readTask(id);
  } catch (error) {
    context.invalidate();
    const artifacts = await context.load();
    const stage = subjectStage(artifacts, id);
    if (!stage) throw error;
    return stageSubject(stage, artifacts);
  }
}

/** A stage keeps its criteria and branch in the milestone file; its status is never stored. */
export async function updateSubject(
  context: ProjectContext,
  id: string,
  patch: TaskPatch,
): Promise<void> {
  const stage = subjectStage(await context.load(), id);
  if (!stage) {
    await context.store.updateTask(id, patch);
    return;
  }
  const own = {
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.branch !== undefined ? { branch: patch.branch } : {}),
  };
  if (Object.keys(own).length) await context.store.updateMilestone(id, own);
  context.invalidate();
}
