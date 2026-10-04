import { type ProjectArtifacts } from '@skaro/core';
import type { ProposedTaskArgs } from '@skaro/mcp-server';
import { type ProposalResult, type ProposedTask } from '@skaro/timeline';
import type { ProjectContext } from './projects';
import { taskBody } from './task-body';
import { type PlanProposal, LiveChat } from './chat-model';
import { adrId, findCycle } from './chat-proposal-helpers';

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
    const chosen = proposal.tasks.filter((t) => !picked || picked.includes(t.ref));
    if (!chosen.length) throw new Error('No tasks are selected');
    const { store } = context;
    const artifacts = await context.load();
    const result: ProposalResult = {};
    let milestone =
      proposal.milestone && !proposal.milestone.isNew ? proposal.milestone.id : undefined;
    if (milestone && !artifacts.milestones.some((m) => m.id === milestone)) {
      throw new Error(`Milestone ${milestone} no longer exists`);
    }
    if (proposal.milestone?.isNew) {
      const created = await store.createMilestone({
        title: proposal.milestone.title,
        ...(proposal.milestone.body ? { body: proposal.milestone.body } : {}),
      });
      milestone = created.id;
      result.milestone = { id: created.id, title: created.title };
    }

    // Refs of tasks earlier cards of this chat created, then the ones created now.
    const known = new Map<string, string>();
    for (const item of live.timeline.state.items) {
      if (item.kind === 'proposal')
        for (const t of item.result?.tasks ?? []) known.set(t.ref, t.id);
    }
    const existing = new Set(artifacts.tasks.map((t) => t.id));
    const specs = new Set(artifacts.specs.map((s) => s.id));
    let order =
      Math.max(
        0,
        ...artifacts.tasks.filter((t) => t.milestone === milestone).map((t) => t.order ?? 0),
      ) + 1;
    const created: { id: string; title: string; ref: string }[] = [];
    for (const task of chosen) {
      const t = await store.createTask({
        title: task.title,
        body: task.body,
        order: order++,
        ...(milestone ? { milestone } : {}),
        ...(task.spec && specs.has(task.spec) ? { spec: task.spec } : {}),
      });
      known.set(task.ref, t.id);
      created.push({ id: t.id, title: t.title, ref: task.ref });
    }
    const dropped: string[] = [];
    for (const [i, task] of chosen.entries()) {
      const ids: string[] = [];
      task.dependsOn.forEach((dep, d) => {
        const id = known.get(dep) ?? (existing.has(dep) ? dep : undefined);
        if (id) ids.push(id);
        else dropped.push(`"${task.title}" → "${task.dependsOnTitles[d] ?? dep}"`);
      });
      if (ids.length) await store.updateTask(created[i]!.id, { dependsOn: ids });
    }
    result.tasks = created;
    this.ctx.deps.db.addEvent(live.projectId, 'tasks_created', {
      count: created.length,
      ...(milestone ? { milestone } : {}),
    });

    const skipped = proposal.tasks.filter((t) => !chosen.includes(t));
    const note = [
      result.milestone
        ? `The user created milestone ${result.milestone.id} "${result.milestone.title}" with tasks:`
        : `The user created tasks${milestone ? ` in ${milestone}` : ''}:`,
      created.map((t) => `${t.id} "${t.title}"`).join(', ') + '.',
      skipped.length ? `Not taken: ${skipped.map((t) => `"${t.title}"`).join(', ')}.` : '',
      dropped.length
        ? `Dependencies left out because the task was not created: ${dropped.join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { result, note };
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
  checkTasks(
    live: LiveChat,
    artifacts: ProjectArtifacts,
    tasks: ProposedTaskArgs[],
  ): string | undefined {
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
    const specs = new Set(artifacts.specs.map((s) => s.id));
    const noSpec = tasks.filter((t) => t.spec && !specs.has(adrId(t.spec)));
    if (noSpec.length) {
      return (
        `Unknown specifications: ${[...new Set(noSpec.map((t) => t.spec))].join(', ')}. ` +
        'Link tasks only to accepted specifications (get_project_context lists them).'
      );
    }
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
