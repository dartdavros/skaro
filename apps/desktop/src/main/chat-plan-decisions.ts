import type { ProjectArtifacts } from '@skaro/core';
import type { ChatEngine } from './chat-engine';
import type { LiveChat, ProposalItem } from './chat-model';
import { PlanJournal, type PlanDecision } from './chat-plan-journal';
import { createdPlanRefs } from './chat-plan-ready';
import { checkedPlanDependencies } from './chat-plan-dependencies';
import type { ProposedTask } from '@skaro/timeline';
import { planSpecProblem } from './chat-plan-specs';
import { adrId } from './chat-proposal-helpers';
import { reconcilePlanIdentity } from './chat-plan-identity';
import { serializePlanCreation } from './chat-plan-mutations';
import { pendingC4PlanProblem } from './chat-plan-c4';

/** One durable decision covers the validated graph; creation resumes without another approval. */
export class ChatPlanDecisions {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }

  async accept(live: LiveChat, item: ProposalItem, picked?: string[]): Promise<void> {
    const artifacts = await this.ctx.project(live.projectId).store.load();
    item = reconcilePlanIdentity(item, live.timeline.state.items, artifacts);
    if (item.proposal.type !== 'plan') throw new Error('Expected a plan');
    const done = new Set(item.result?.tasks?.map((t) => t.ref));
    const selected = item.proposal.tasks
      .filter(
        (t) =>
          !done.has(t.ref) &&
          (picked ? picked.includes(t.ref) : !item.result?.omitted?.includes(t.ref)),
      )
      .map((t) => t.ref);
    if (!selected.length) {
      if (item.state !== 'applied') throw new Error('No tasks are selected');
      new PlanJournal(this.ctx, live).save({ item });
      return;
    }
    if (new Set(item.proposal.tasks.map((t) => t.ref)).size !== item.proposal.tasks.length)
      throw new Error('Duplicate task refs');
    const chosen = item.proposal.tasks.filter((t) => selected.includes(t.ref));
    await this.validate(live, chosen, artifacts, item);
    for (const task of chosen) {
      const milestone = task.milestone ?? item.proposal.milestone;
      if (milestone && !milestone.isNew && !artifacts.milestones.some((m) => m.id === milestone.id))
        throw new Error(`Milestone ${milestone.id} no longer exists`);
    }
    new PlanJournal(this.ctx, live).save({
      item: {
        ...item,
        state: 'accepted',
        result: {
          ...item.result,
          selected,
          waiting: undefined,
          error: undefined,
          omitted: item.proposal.tasks
            .filter((t) => !done.has(t.ref) && !selected.includes(t.ref))
            .map((t) => t.ref),
          tasks: item.result?.tasks ?? [],
        },
      },
    });
    this.ctx.proposals.addNotes(live.chat.id, [
      `The user confirmed the complete plan: ${selected.length} tasks. Create the entire selected graph without further owner decisions.`,
      ...(item.proposal.tasks.some((t) => !done.has(t.ref) && !selected.includes(t.ref))
        ? [
            `Not taken: ${item.proposal.tasks
              .filter((t) => !done.has(t.ref) && !selected.includes(t.ref))
              .map((t) => `"${t.title}"`)
              .join(', ')}.`,
          ]
        : []),
    ]);
  }

  async cancel(live: LiveChat, item: ProposalItem): Promise<void> {
    const journal = new PlanJournal(this.ctx, live);
    const decision = journal.list().find((r) => r.item.id === item.id);
    if (!decision) throw new Error('The decision is not found');
    const artifacts = await this.ctx.project(live.projectId).store.load();
    const result = { ...decision.item.result, waiting: [] };
    const written = artifacts.tasks.find((t) => t.id === decision.creating?.id);
    if (written && !result.tasks?.some((t) => t.id === written.id)) {
      result.tasks = [
        ...(result.tasks ?? []),
        { id: written.id, title: written.title, ref: decision.creating!.ref },
      ];
    }
    const milestone = artifacts.milestones.find((m) => m.id === decision.milestoneId);
    if (milestone) result.milestone = { id: milestone.id, title: milestone.title };
    delete decision.creating;
    decision.item = { ...item, state: 'rejected', result };
    journal.save(decision);
    this.ctx.proposals.addNotes(live.chat.id, [
      'The user cancelled the remaining approved tasks; tasks already created were preserved.',
    ]);
  }

  async drain(live: LiveChat): Promise<void> {
    const journal = new PlanJournal(this.ctx, live);
    journal.restore();
    if (!journal.list().some((r) => r.item.state === 'accepted')) return;
    return serializePlanCreation(this.ctx, live.projectId, () => this.drainProject(live));
  }

  private async drainProject(live: LiveChat): Promise<void> {
    const journal = new PlanJournal(this.ctx, live);
    journal.restore();
    const artifacts = await this.ctx.project(live.projectId).store.load();
    let progress: boolean;
    do {
      progress = false;
      for (const decision of journal.list().filter((r) => r.item.state === 'accepted')) {
        try {
          if (await this.advance(live, journal, decision, artifacts)) progress = true;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const previous = decision.item.result?.error;
          decision.item.result = { ...decision.item.result, error: reason, waiting: undefined };
          journal.save(decision);
          if (previous !== reason) this.ctx.history.notice(live, 'other', 'error', reason);
        }
      }
    } while (progress);
    this.ctx.project(live.projectId).invalidate();
  }

  private async advance(
    live: LiveChat,
    journal: PlanJournal,
    decision: PlanDecision,
    artifacts: ProjectArtifacts,
  ): Promise<boolean> {
    const item = reconcilePlanIdentity(
      decision.item,
      live.timeline.state.items,
      artifacts,
      decision.creating,
    );
    decision.item = item;
    if (decision.creating && item.result?.tasks?.some((t) => t.ref === decision.creating!.ref))
      delete decision.creating;
    journal.save(decision);
    if (item.proposal.type !== 'plan') return false;
    const proposal = item.proposal;
    const store = this.ctx.project(live.projectId).store;
    const known = createdPlanRefs(live.timeline.state.items, artifacts);
    const result = item.result!;
    const remaining = proposal.tasks.filter(
      (t) => result.selected!.includes(t.ref) && !result.tasks?.some((done) => done.ref === t.ref),
    );
    await this.validate(live, remaining, artifacts);
    const task = decision.creating
      ? remaining.find((t) => t.ref === decision.creating!.ref)
      : remaining.find(
          (t) =>
            t.dependsOn.every((dep) => known.has(dep)) &&
            !planSpecProblem([t], artifacts.specs, artifacts),
        );
    if (!task) {
      if (remaining.length) throw new Error('The approved task graph cannot be created.');
      item.state = 'applied';
      delete result.error;
      delete result.waiting;
      journal.save(decision);
      return false;
    }
    const milestone = await this.milestone(live, journal, decision, artifacts, task);
    if (!decision.creating) {
      decision.creating = {
        ref: task.ref,
        id: await store.reserveTaskId(),
        input: {
          title: task.title,
          body: task.body,
          dependsOn: task.dependsOn.map((ref) => known.get(ref)!),
          order:
            Math.max(
              0,
              ...artifacts.tasks.filter((t) => t.milestone === milestone).map((t) => t.order ?? 0),
            ) + 1,
          ...(milestone ? { milestone } : {}),
          ...(task.spec ? { spec: adrId(task.spec) } : {}),
        },
      };
      journal.save(decision);
    }
    const created = await store.createReservedTask(decision.creating.id, decision.creating.input);
    if (!artifacts.tasks.some((t) => t.id === created.id)) artifacts.tasks.push(created);
    result.tasks = [
      ...(result.tasks ?? []),
      { id: created.id, title: created.title, ref: task.ref },
    ];
    delete decision.creating;
    delete result.waiting;
    delete result.error;
    if (result.selected!.every((ref) => result.tasks!.some((t) => t.ref === ref)))
      item.state = 'applied';
    journal.save(decision);
    this.ctx.deps.db.addEvent(live.projectId, 'tasks_created', {
      count: 1,
      milestone: created.milestone,
    });
    this.ctx.proposals.addNotes(live.chat.id, [
      `Created approved task ${created.id} "${created.title}" with dependencies: ${created.dependsOn.join(', ') || 'none'}.`,
    ]);
    this.ctx.deps.emit('project.changed', { projectId: live.projectId });
    return true;
  }

  private async milestone(
    live: LiveChat,
    journal: PlanJournal,
    decision: PlanDecision,
    artifacts: ProjectArtifacts,
    task: ProposedTask,
  ) {
    const proposal = decision.item.proposal;
    if (proposal.type !== 'plan') return undefined;
    const target = task.milestone ?? proposal.milestone;
    if (!target) return undefined;
    if (!target.isNew) {
      if (!artifacts.milestones.some((m) => m.id === target.id))
        throw new Error(`Milestone ${target.id} no longer exists`);
      return target.id;
    }
    const store = this.ctx.project(live.projectId).store;
    decision.milestoneIds ??= {};
    if (!decision.milestoneIds[target.id]) {
      decision.milestoneIds[target.id] = decision.milestoneId ?? (await store.reserveMilestoneId());
      journal.save(decision);
    }
    const id = decision.milestoneIds[target.id]!;
    if (!decision.item.result?.milestones?.some((m) => m.id === id)) {
      const created = await store.createReservedMilestone(id, target);
      if (!artifacts.milestones.some((m) => m.id === created.id))
        artifacts.milestones.push(created);
      decision.item.result!.milestones = [
        ...(decision.item.result?.milestones ?? []),
        { id: created.id, title: created.title },
      ];
      if (proposal.milestone)
        decision.item.result!.milestone = { id: created.id, title: created.title };
      journal.save(decision);
    } else if (!artifacts.milestones.some((m) => m.id === id)) {
      throw new Error(`Milestone ${id} no longer exists`);
    }
    return id;
  }

  private async validate(
    live: LiveChat,
    tasks: ProposedTask[],
    artifacts: ProjectArtifacts,
    item?: ProposalItem,
  ) {
    const architecture = await pendingC4PlanProblem(this.ctx.deps.db, live.projectId, tasks);
    if (architecture) throw new Error(architecture);
    const problem = planSpecProblem(tasks, artifacts.specs, artifacts);
    if (problem) throw new Error(problem);
    checkedPlanDependencies(
      tasks,
      item ? [...live.timeline.state.items, item] : live.timeline.state.items,
      artifacts,
    );
  }
}
