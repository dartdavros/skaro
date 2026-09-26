// "Проекты" (Projects mockup): one card per project — task statuses, the current milestone, tasks
// agents work on now, branch and last activity; and opening the folder in other apps.

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  displayStatus,
  indexTasks,
  milestoneProgress,
  type AppDb,
  type ProjectRecord,
} from '@skaro/core';
import type { AgentId, OverviewTask, ProjectCard, ProjectOverview } from '../shared/ipc';
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

/** "Обзор" of one project (ProjectOverview mockup). */
export async function projectOverview(
  db: AppDb,
  projects: Projects,
  projectId: string,
): Promise<ProjectOverview> {
  const project = db.getProject(projectId);
  if (!project) throw new Error('unknown project');
  const context = projects.get(projectId);
  const [artifacts, branch, clean] = await Promise.all([
    context.load(),
    context.git.currentBranch().catch(() => undefined),
    context.git.isClean().catch(() => undefined),
  ]);
  const index = indexTasks(artifacts.tasks);
  const runtime = db.getTaskRuntime(projectId);
  const runs = db.listRuns(projectId);
  const milestoneOf = (id?: string) => {
    const m = artifacts.milestones.find((x) => x.id === id);
    return m ? { id: m.id, title: m.title } : undefined;
  };

  const attention: OverviewTask[] = [];
  const running: OverviewTask[] = [];
  const queued: { id: string; title: string }[] = [];
  const work: Promise<void>[] = [];
  for (const task of artifacts.tasks.filter((t) => !t.archived)) {
    const state = runtime.get(task.id)?.state;
    const status = displayStatus(task, index, state);
    if (status === 'queued') {
      queued.push({ id: task.id, title: task.title });
      continue;
    }
    if (status !== 'review' && status !== 'needs_answer' && status !== 'in_progress') continue;
    const run = runs.find((r) => r.taskId === task.id);
    const milestone = milestoneOf(task.milestone);
    const item: OverviewTask = {
      id: task.id,
      title: task.title,
      ...(milestone ? { milestone } : {}),
      status,
      since:
        status === 'in_progress' ? (run?.startedAt ?? 0) : (run?.endedAt ?? run?.startedAt ?? 0),
      agent: run?.agent === 'codex' ? 'codex' : 'claude-code',
      ...(run?.model ? { model: run.model } : {}),
    };
    (status === 'in_progress' ? running : attention).push(item);
    const worktree = run?.worktree;
    if (worktree && existsSync(worktree)) {
      work.push(
        context.git
          .worktreeStats(worktree, artifacts.config.baseBranch)
          .then((stats) => void (item.stats = stats))
          .catch(() => undefined),
      );
    }
  }

  const briefStat = await stat(join(context.root, '.skaro', 'brief.md')).catch(() => undefined);
  const withProgress = artifacts.milestones.map((m) => ({
    m,
    progress: milestoneProgress(m, artifacts.tasks),
  }));
  const empty = withProgress.find((x) => x.progress.total === 0)?.m;
  const titles = new Map(artifacts.tasks.map((t) => [t.id, t.title]));
  await Promise.all(work);

  return {
    id: projectId,
    name: project.name,
    path: project.path,
    ...(branch ? { branch } : {}),
    ...(clean !== undefined ? { clean } : {}),
    attention: attention.sort((a, b) => b.since - a.since),
    running,
    queued,
    start: {
      ...(artifacts.brief && briefStat ? { brief: { updatedAt: briefStat.mtimeMs } } : {}),
      ...(artifacts.architecture
        ? {
            architecture: {
              adrs: artifacts.adrs.length,
              rules: countRules(artifacts.architecture.body),
            },
          }
        : {}),
      milestones: artifacts.milestones.length,
      tasks: artifacts.tasks.length,
      ...(empty ? { emptyMilestone: { id: empty.id, title: empty.title } } : {}),
      hidden: db.getSetting<boolean | null>(`overview.${projectId}.startHidden`, null) === true,
    },
    milestones: withProgress.map(({ m, progress }) => ({
      id: m.id,
      title: m.title,
      done: progress.done,
      total: progress.total,
    })),
    events: db.listEvents(projectId, 6).map((e) => {
      const task = typeof e.data['task'] === 'string' ? titles.get(e.data['task']) : undefined;
      const milestone =
        typeof e.data['milestone'] === 'string' ? milestoneOf(e.data['milestone']) : undefined;
      return {
        kind: e.kind,
        data: e.data,
        at: e.at,
        ...(task ? { taskTitle: task } : {}),
        ...(milestone ? { milestoneTitle: milestone.title } : {}),
      };
    }),
  };
}

/** Rules for the agents: items of the "Правила и ограничения" section of the architecture. */
function countRules(body: string): number {
  let inRules = false;
  let count = 0;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      inRules = /правила|rules/i.test(heading[1]!);
      continue;
    }
    if (inRules && /^\s*(?:[-*]|\d+\.)\s+\S/.test(line)) count++;
  }
  return count;
}
