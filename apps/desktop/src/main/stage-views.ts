// Where a stage stands, as "План" and the stage screen show it. Nothing of it is stored: it is
// read from the task files, the runtime of the agents and the queue.

import {
  indexTasks,
  isBlocked,
  pendingDependencies,
  type Milestone,
  type ProjectArtifacts,
  type Task,
  type TaskRuntime,
} from '@skaro/core';
import type { StageInfo } from '../shared/ipc';
import { stageTasks } from './task-stage';
import { stageStatus } from './task-subject';

const finished = (task: Task) => task.status === 'review' || task.status === 'done';

const NOTICES: Record<string, { review: string; need: string }> = {
  ru: { review: 'Этап {id} ждёт слияния', need: 'Приёмка {id}: нужен ответ' },
  en: { review: 'Milestone {id} awaits the merge', need: 'Acceptance of {id}: needs an answer' },
};

/** The words of a system notification about a stage; other kinds keep the usual ones. */
export function stageNotice(kind: string, stageId: string, locale: string): string | undefined {
  const words = NOTICES[locale] ?? NOTICES['en']!;
  return kind === 'review' || kind === 'need' ? words[kind].replace('{id}', stageId) : undefined;
}

/** Tasks of the stage in the order they run: the order of the plan. */
export function orderedStageTasks(stage: Pick<Milestone, 'id'>, artifacts: ProjectArtifacts) {
  return stageTasks(stage, artifacts)
    .filter((t) => t.status !== 'cancelled')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

export function stageInfo(
  stage: Milestone,
  artifacts: ProjectArtifacts,
  runtime: ReadonlyMap<string, { state: TaskRuntime }>,
  options: {
    /** Tasks told to start that wait for their dependencies. */
    awaiting: ReadonlySet<string>;
    /** The acceptance of the stage has been started at least once. */
    accepted: boolean;
  },
): StageInfo {
  const tasks = orderedStageTasks(stage, artifacts);
  const state = (id: string) => runtime.get(id)?.state;
  const base = {
    id: stage.id,
    finished: tasks.filter(finished).length,
    total: tasks.length,
    mergeable: tasks.filter((t) => t.status === 'review').length,
    ...(stage.branch ? { branch: stage.branch } : {}),
  };
  if (tasks.length && tasks.every((t) => t.status === 'done')) return { ...base, state: 'done' };

  const failed = tasks.find((t) => state(t.id) === 'failed');
  if (failed) return { ...base, state: 'error', task: failed.id };
  const running = tasks.find((t) => state(t.id) === 'running');
  if (running) return { ...base, state: 'running', task: running.id };
  const waiting = tasks.find(
    (t) => state(t.id) === 'waiting' || (t.status === 'in_progress' && state(t.id) !== 'queued'),
  );
  if (waiting) return { ...base, state: 'needs_answer', task: waiting.id };

  if (tasks.length && tasks.every(finished)) {
    const own = state(stage.id);
    if (own === 'running' || own === 'queued') return { ...base, state: 'acceptance' };
    if (own === 'waiting' || own === 'failed') {
      return { ...base, state: 'acceptance_needs_answer' };
    }
    if (stageStatus(stage, artifacts) === 'review') return { ...base, state: 'awaiting_merge' };
    // The acceptance starts by itself after the last task; one that never did is continued.
    return { ...base, state: options.accepted ? 'acceptance_needs_answer' : 'stopped' };
  }

  const queued = tasks.find((t) => state(t.id) === 'queued' || options.awaiting.has(t.id));
  if (queued) return { ...base, state: 'queued', task: queued.id };
  if (tasks.some((t) => t.status !== 'todo')) return { ...base, state: 'stopped' };

  // Not started. It cannot be while its first task waits for a task of another stage.
  const index = indexTasks(artifacts.tasks);
  const first = tasks[0];
  if (first && tasks.every((t) => isBlocked(t, index))) {
    const dep = pendingDependencies(first, index)
      .map((id) => index.get(id))
      .find((t) => t && t.milestone !== stage.id);
    if (dep) {
      return {
        ...base,
        state: 'idle',
        waitsFor: { task: dep.id, ...(dep.milestone ? { stage: dep.milestone } : {}) },
      };
    }
  }
  return { ...base, state: 'idle' };
}
