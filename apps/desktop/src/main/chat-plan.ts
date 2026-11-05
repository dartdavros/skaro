import { type ProjectArtifacts } from '@skaro/core';
import type { ProposedTaskArgs } from '@skaro/mcp-server';
import { type ProposalResult, type ProposedTask } from '@skaro/timeline';
import type { ProjectContext } from './projects';
import { taskBody } from './task-body';
import { type PlanProposal, LiveChat } from './chat-model';
import { adrId, findCycle } from './chat-proposal-helpers';
import { applyChatPlan } from './chat-plan-apply';
import { planSpecProblem } from './chat-plan-specs';
import { pendingC4PlanProblem } from './chat-plan-c4';

import type { ChatEngine } from './chat-engine';

/** A task with its ref and dependencies renamed by `ChatPlan.freshRefs`. */
export function withRefs(task: ProposedTaskArgs, renames: Map<string, string>): ProposedTaskArgs {
  if (!renames.size) return task;
  return {
    ...task,
    ref: renames.get(task.ref) ?? task.ref,
    dependsOn: task.dependsOn.map((d) => renames.get(d) ?? d),
  };
}

export class ChatPlan {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  async applyPlan(
    live: LiveChat,
    context: ProjectContext,
    proposal: PlanProposal,
    picked: string[] | undefined,
  ): Promise<{ result: ProposalResult; note: string }> {
    return applyChatPlan({
      store: context.store,
      artifacts: await context.load(),
      db: this.ctx.deps.db,
      projectId: live.projectId,
      items: live.timeline.state.items,
      proposal,
      ...(picked !== undefined ? { picked } : {}),
    });
  }

  /** Refs of tasks earlier cards of this chat proposed. */
  private earlierRefs(live: LiveChat): Set<string> {
    return new Set(
      this.ctx.proposals
        .proposals(live)
        .flatMap((p) => (p.proposal.type === 'plan' ? p.proposal.tasks.map((t) => t.ref) : [])),
    );
  }

  /**
   * Refs of this call that earlier cards of the chat already used get new ones (t1 → t1-2), so
   * the agent never resends a plan because of them. Inside the call its own task wins: a
   * dependency on a renamed ref goes to the renamed task.
   */
  freshRefs(live: LiveChat, tasks: ProposedTaskArgs[]): Map<string, string> {
    const earlier = this.earlierRefs(live);
    const taken = new Set([...earlier, ...tasks.map((t) => t.ref)]);
    const renames = new Map<string, string>();
    for (const ref of new Set(tasks.map((t) => t.ref))) {
      if (!earlier.has(ref)) continue;
      let n = 2;
      while (taken.has(`${ref}-${n}`)) n++;
      renames.set(ref, `${ref}-${n}`);
      taken.add(`${ref}-${n}`);
    }
    return renames;
  }

  /** What the agent is told about renamed refs, if any. */
  renamedNote(renames: Map<string, string>): string {
    if (!renames.size) return '';
    const pairs = [...renames].map(([from, to]) => `${from} → ${to}`).join(', ');
    return ` Refs already used by earlier cards of this chat were renamed: ${pairs}.`;
  }

  /** Refs tasks of this chat may depend on: this call, earlier cards, existing tasks. */
  async checkTasks(
    live: LiveChat,
    artifacts: ProjectArtifacts,
    tasks: ProposedTaskArgs[],
  ): Promise<string | undefined> {
    const architecture = await pendingC4PlanProblem(this.ctx.deps.db, live.projectId, tasks);
    if (architecture) return architecture;
    const earlier = this.earlierRefs(live);
    const refs = new Set(tasks.map((t) => t.ref));
    const ids = new Set(artifacts.tasks.map((t) => t.id));
    const unknown = tasks.flatMap((t) =>
      t.dependsOn.filter((d) => !refs.has(d) && !earlier.has(d) && !ids.has(d.toUpperCase())),
    );
    if (unknown.length) {
      return (
        `Unknown dependencies: ${[...new Set(unknown)].join(', ')}. Use refs of tasks in this ` +
        'call or of earlier cards, or ids of existing tasks.'
      );
    }
    const specProblem = planSpecProblem(tasks, artifacts.specs, artifacts);
    if (specProblem) return specProblem;
    const self = tasks.filter((t) => t.dependsOn.includes(t.ref));
    if (self.length) return `A task cannot depend on itself: ${self.map((t) => t.ref).join(', ')}.`;
    const cycle = findCycle(tasks);
    if (cycle) return `Dependencies form a cycle: ${cycle.join(' → ')}.`;
    return undefined;
  }

  titlesByRef(
    live: LiveChat,
    artifacts: ProjectArtifacts,
    tasks: ProposedTaskArgs[],
  ): Map<string, string> {
    const titles = new Map<string, string>();
    for (const t of artifacts.tasks) titles.set(t.id, t.title);
    for (const p of this.ctx.proposals.proposals(live)) {
      if (p.proposal.type === 'plan') for (const t of p.proposal.tasks) titles.set(t.ref, t.title);
    }
    for (const t of tasks) titles.set(t.ref, t.title);
    return titles;
  }

  proposedTask(task: ProposedTaskArgs, titles: Map<string, string>): ProposedTask {
    const dependsOn = task.dependsOn.map((d) => (titles.has(d) ? d : d.toUpperCase()));
    return {
      ref: task.ref,
      title: task.title,
      body: taskBody(
        {
          goal: task.goal,
          criteria: task.criteria,
          ...(task.notes ? { notes: task.notes } : {}),
        },
        this.ctx.deps.locale(),
      ),
      dependsOn,
      dependsOnTitles: dependsOn.map((d) => titles.get(d) ?? d),
      ...(task.spec ? { spec: adrId(task.spec) } : {}),
    };
  }
}
