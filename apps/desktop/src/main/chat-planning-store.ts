import type { AppDb, ProjectArtifacts } from '@skaro/core';
import type { PreparePlanArgs } from '@skaro/mcp-server';
import { findCycle } from './chat-proposal-helpers';

export interface SavedChatPlan extends PreparePlanArgs {
  revision?: number;
  state: 'active' | 'waiting' | 'paused' | 'blocked' | 'complete' | 'cancelled';
  reason?: string;
  /** Retained for decoding drafts written by earlier versions. */
  attempts?: number;
  lastProgress?: number;
}

const storageKey = (chatId: string) => `chat.planning.${chatId}`;

/** Full drafts are stored separately from cards; never reconstructed from prose. */
export class ChatPlanningStore {
  private readonly db: AppDb;
  private readonly chatId: string;
  constructor(db: AppDb, chatId: string) {
    this.db = db;
    this.chatId = chatId;
  }

  list(): SavedChatPlan[] {
    return this.db.getSetting<SavedChatPlan[]>(storageKey(this.chatId), []);
  }

  get(key: string): SavedChatPlan | undefined {
    return this.list().find((plan) => plan.key === key);
  }

  current(): SavedChatPlan | undefined {
    return this.list().find((plan) => plan.state !== 'complete' && plan.state !== 'cancelled');
  }

  put(plan: SavedChatPlan): void {
    const plans = this.list();
    const index = plans.findIndex((p) => p.key === plan.key);
    if (index < 0) plans.push(plan);
    else plans[index] = plan;
    this.db.setSetting(storageKey(this.chatId), plans);
  }
}

export function qualifiedPlan(args: PreparePlanArgs): PreparePlanArgs {
  const renames = new Map(
    args.milestones.flatMap((m) => m.tasks).map((t) => [t.ref, `plan:${args.key}:${t.ref}`]),
  );
  return {
    ...args,
    milestones: args.milestones.map((m) => ({
      ...m,
      tasks: m.tasks.map((t) => ({
        ...t,
        ref: renames.get(t.ref)!,
        dependsOn: t.dependsOn.map((d) => renames.get(d) ?? d.toUpperCase()),
      })),
    })),
  };
}

export function preparedPlanProblem(
  plan: PreparePlanArgs,
  artifacts: ProjectArtifacts,
): string | undefined {
  const tasks = plan.milestones.flatMap((m) => m.tasks);
  if (tasks.length !== plan.expectedTotal || !tasks.length) return 'Incomplete task records.';
  if (new Set(tasks.map((t) => t.ref)).size !== tasks.length) return 'Duplicate task refs.';
  const refs = new Set(tasks.map((t) => t.ref));
  const existing = new Set(artifacts.tasks.map((t) => t.id));
  const unknown = tasks.flatMap((t) => t.dependsOn.filter((d) => !refs.has(d) && !existing.has(d)));
  if (unknown.length) return `Unknown dependencies: ${[...new Set(unknown)].join(', ')}.`;
  const cycle = findCycle(tasks);
  if (cycle) return `Dependencies form a cycle: ${cycle.join(' → ')}.`;
  for (const group of plan.milestones) {
    if (!artifacts.milestones.some((m) => m.id === group.milestone)) {
      return `Milestone ${group.milestone} does not exist; obtain acceptance first.`;
    }
    if (!group.tasks.length) return `Milestone ${group.milestone} has no implementation tasks.`;
    const expected = new Set(group.requirements);
    const covered = new Set(group.tasks.flatMap((t) => t.requirements));
    const missing = [...expected].filter((r) => !covered.has(r));
    const extra = [...covered].filter((r) => !expected.has(r));
    if (missing.length || extra.length) {
      return `${group.milestone}: uncovered requirements [${missing.join(', ')}], out-of-scope requirements [${extra.join(', ')}].`;
    }
  }
  return undefined;
}
