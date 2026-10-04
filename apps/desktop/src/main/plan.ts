// "План" (Plan mockup): milestones with their goal and done criterion, their order, and where
// each task sits. The files in .skaro/milestones and .skaro/tasks are the source of truth.

import type { Milestone } from '@skaro/core';
import type { Events, EventName, MilestoneInfo, MilestoneInput } from '../shared/ipc';
import type { Projects } from './projects';
import { headings } from './task-body';

interface Deps {
  projects: Projects;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  /** Deletes tasks with their branches and worktrees (TaskBoard.delete). */
  deleteTasks: (projectId: string, taskIds: string[]) => Promise<void>;
}

const GOAL = new Set(['цель', 'goal']);
const DONE = new Set(['критерий готовности', 'done when', 'definition of done']);

/** "Цель" and "Критерий готовности" of a milestone body. */
export function milestoneSections(body: string): { goal?: string; criteria?: string } {
  const parts: Record<'goal' | 'criteria', string[]> = { goal: [], criteria: [] };
  let current: 'goal' | 'criteria' | undefined;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const name = heading[1]!.toLowerCase();
      current = GOAL.has(name) ? 'goal' : DONE.has(name) ? 'criteria' : undefined;
      continue;
    }
    if (current) parts[current].push(line);
  }
  const goal = parts.goal.join('\n').trim();
  const criteria = parts.criteria.join('\n').trim();
  return { ...(goal ? { goal } : {}), ...(criteria ? { criteria } : {}) };
}

export function milestoneBody(input: MilestoneInput, locale: string): string {
  const h = headings(locale);
  return `## ${h.goal}\n\n${input.goal.trim()}\n\n## ${h.done}\n\n${input.criteria.trim()}\n`;
}

/** The acceptance of a stage ticks the criterion as a list; the plan shows its words. */
function readinessWords(criteria: string): string {
  return criteria
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter(Boolean)
    .join('; ');
}

function info(m: Milestone): MilestoneInfo {
  const { goal, criteria } = milestoneSections(m.body);
  return {
    id: m.id,
    title: m.title,
    order: m.order,
    ...(goal ? { goal } : {}),
    ...(criteria ? { criteria: readinessWords(criteria) } : {}),
  };
}

export class Plan {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async milestones(projectId: string): Promise<MilestoneInfo[]> {
    const { milestones } = await this.deps.projects.get(projectId).load();
    return [...milestones].sort((a, b) => a.order - b.order).map(info);
  }

  /**
   * Deletes a milestone that has no started task, together with its tasks. A milestone with
   * started work is archived instead: it leaves the plan when all its tasks are archived.
   */
  async delete(projectId: string, milestoneId: string): Promise<void> {
    const context = this.deps.projects.get(projectId);
    const own = (await context.load()).tasks.filter((t) => t.milestone === milestoneId);
    if (own.some((t) => t.status !== 'todo'))
      throw new Error(`milestone ${milestoneId} has started tasks`);
    if (own.length)
      await this.deps.deleteTasks(
        projectId,
        own.map((t) => t.id),
      );
    await context.store.deleteMilestone(milestoneId);
    this.changed(projectId);
  }

  async reorder(projectId: string, milestoneIds: string[]): Promise<void> {
    const { store } = this.deps.projects.get(projectId);
    for (const [i, id] of milestoneIds.entries()) await store.updateMilestone(id, { order: i + 1 });
    this.changed(projectId);
  }

  /** A dragged task: into `milestoneId` at `index`; the tasks there are renumbered. */
  async placeTask(
    projectId: string,
    taskId: string,
    milestoneId: string,
    index: number,
  ): Promise<void> {
    const context = this.deps.projects.get(projectId);
    const { tasks } = await context.load();
    // "" is "Без этапа": the task leaves its milestone. Archived tasks are not on the plan.
    const target = milestoneId || undefined;
    const siblings = tasks
      .filter((t) => t.milestone === target && t.id !== taskId && !t.archived)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const moved = tasks.find((t) => t.id === taskId);
    if (!moved) throw new Error(`unknown task ${taskId}`);
    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, moved);
    for (const [i, task] of siblings.entries()) {
      const patch = {
        ...(task.order !== i + 1 ? { order: i + 1 } : {}),
        ...(task.milestone !== target ? { milestone: target } : {}),
      };
      if (Object.keys(patch).length) await context.store.updateTask(task.id, patch);
    }
    this.changed(projectId);
  }

  private changed(projectId: string): void {
    this.deps.projects.get(projectId).invalidate();
    this.deps.emit('project.changed', { projectId });
  }
}
