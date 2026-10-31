import { requireAgentId, DEFAULT_AGENT } from '@skaro/agents';
// "Проекты" (Projects mockup): one card per project — task statuses, the current milestone, tasks
// agents work on now, branch and last activity; and opening the folder in other apps.

import { existsSync } from 'node:fs';
import {
  displayStatus,
  indexTasks,
  indexMilestoneProgress,
  type ProjectArtifacts,
  type AppDb,
  type ProjectRecord,
} from '@skaro/core';
import type { ProjectCard } from '../shared/ipc';
import type { Projects } from './projects';

export async function projectCards(db: AppDb, projects: Projects): Promise<ProjectCard[]> {
  return Promise.all(db.listProjects().map((p) => projectCard(db, projects, p)));
}

export async function projectCard(
  db: AppDb,
  projects: Projects,
  project: ProjectRecord,
): Promise<ProjectCard> {
  return projectCardFrom(db, project, {
    summary: () => projects.get(project.id).summary(),
    branch: () => projects.get(project.id).git.currentBranch(),
  });
}

export async function projectCardFrom(
  db: AppDb,
  project: ProjectRecord,
  read: {
    summary(): Promise<ProjectArtifacts>;
    branch(): Promise<string | undefined>;
  },
): Promise<ProjectCard> {
  const card: ProjectCard = {
    id: project.id,
    name: project.name,
    path: project.path,
    missing: !existsSync(project.path),
    ...(project.logo ? { logo: project.logo } : {}),
    counts: { working: 0, needs: 0, review: 0, failed: 0, blocked: 0 },
    running: [],
    agent: DEFAULT_AGENT,
    activeAt: Math.max(project.createdAt, project.lastOpenedAt ?? 0, db.shell.activity(project.id)),
  };
  if (card.missing) return card;

  const [artifacts, branch] = await Promise.all([
    read.summary().catch(() => undefined),
    read.branch().catch(() => undefined),
  ]);
  if (branch) card.branch = branch;
  if (!artifacts) return card;

  card.agent = requireAgentId(artifacts.config.defaultAgent);
  if (artifacts.config.defaultModel) card.model = artifacts.config.defaultModel;

  const tasks = artifacts.tasks.filter((t) => !t.archived);
  const index = indexTasks(artifacts.tasks);
  const runtime = db.getTaskRuntime(project.id);
  for (const task of tasks) {
    const state = runtime.get(task.id)?.state;
    const status = displayStatus(task, index, state);
    if (state === 'running' || state === 'waiting') {
      card.runningTotal = (card.runningTotal ?? 0) + 1;
      if (card.running.length < 2) {
        const run = db.shell.runAgent(project.id, task.id);
        card.running.push({
          id: task.id,
          title: task.title,
          agent: requireAgentId(run?.agent ?? DEFAULT_AGENT),
          ...(run?.model ? { model: run.model } : {}),
        });
      }
    }
    if (status === 'in_progress') card.counts.working++;
    else if (status === 'needs_answer') card.counts.needs++;
    else if (status === 'review') card.counts.review++;
    else if (status === 'failed') card.counts.failed++;
    else if (status === 'blocked') card.counts.blocked++;
  }

  // The current milestone: the first one not done yet, else the last one with tasks.
  const progress = indexMilestoneProgress(artifacts.tasks);
  const withTasks = artifacts.milestones.flatMap((m) => {
    const value = progress.get(m.id);
    return value ? [{ m, progress: value }] : [];
  });
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
