// "Проекты" (Projects mockup): one card per project — task statuses, the current milestone, tasks
// agents work on now, branch and last activity; and opening the folder in other apps.

import { existsSync } from 'node:fs';
import {
  displayStatus,
  indexTasks,
  milestoneProgress,
  type AppDb,
  type ProjectRecord,
} from '@skaro/core';
import type { AgentId, ProjectCard } from '../shared/ipc';
import type { Projects } from './projects';

export async function projectCards(db: AppDb, projects: Projects): Promise<ProjectCard[]> {
  return Promise.all(db.listProjects().map((p) => projectCard(db, projects, p)));
}

async function projectCard(
  db: AppDb,
  projects: Projects,
  project: ProjectRecord,
): Promise<ProjectCard> {
  const runs = db.listRuns(project.id);
  const chats = [...db.listChats(project.id), ...db.listChats(project.id, { archived: true })];
  const card: ProjectCard = {
    id: project.id,
    name: project.name,
    path: project.path,
    missing: !existsSync(project.path),
    ...(project.logo ? { logo: project.logo } : {}),
    counts: { working: 0, needs: 0, review: 0, failed: 0, blocked: 0 },
    running: [],
    agent: 'claude-code',
    activeAt: Math.max(
      project.createdAt,
      project.lastOpenedAt ?? 0,
      ...runs.map((r) => r.endedAt ?? r.startedAt),
      ...chats.map((c) => c.updatedAt),
    ),
  };
  if (card.missing) return card;

  const context = projects.get(project.id);
  const [artifacts, branch] = await Promise.all([
    context.load().catch(() => undefined),
    context.git.currentBranch().catch(() => undefined),
  ]);
  if (branch) card.branch = branch;
  if (!artifacts) return card;

  card.agent = artifacts.config.defaultAgent === 'codex' ? 'codex' : 'claude-code';
  if (artifacts.config.defaultModel) card.model = artifacts.config.defaultModel;

  const tasks = artifacts.tasks.filter((t) => !t.archived);
  const index = indexTasks(artifacts.tasks);
  const runtime = db.getTaskRuntime(project.id);
  for (const task of tasks) {
    const state = runtime.get(task.id)?.state;
    const status = displayStatus(task, index, state);
    if (state === 'running' || state === 'waiting') {
      const run = runs.find((r) => r.taskId === task.id);
      card.running.push({
        id: task.id,
        title: task.title,
        agent: (run?.agent === 'codex' ? 'codex' : 'claude-code') as AgentId,
        ...(run?.model ? { model: run.model } : {}),
      });
    }
    if (status === 'in_progress') card.counts.working++;
    else if (status === 'needs_answer') card.counts.needs++;
    else if (status === 'review') card.counts.review++;
    else if (status === 'failed') card.counts.failed++;
    else if (status === 'blocked') card.counts.blocked++;
  }

  // The current milestone: the first one not done yet, else the last one with tasks.
  const withTasks = artifacts.milestones
    .map((m) => ({ m, progress: milestoneProgress(m, artifacts.tasks) }))
    .filter((x) => x.progress.total > 0);
  const current = withTasks.find((x) => x.progress.status !== 'done') ?? withTasks.at(-1);
  if (current) {
    card.milestone = {
      id: current.m.id,
      title: current.m.title,
      done: current.progress.done,
      total: current.progress.total,
    };
  }
  return card;
}
