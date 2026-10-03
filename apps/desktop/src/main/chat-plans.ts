import { type Task } from '@skaro/core';
import type {
  ProposeMilestonesArgs,
  ProposeTasksArgs,
  SkaroScope,
  ToolResult,
  UpdateTaskArgs,
} from '@skaro/mcp-server';
import { headings, withSections } from './task-body';
import { nextNumber, taskText } from './chat-proposal-helpers';
import { withRefs } from './chat-plan';

import type { ChatEngine } from './chat-engine';

export class ChatPlans {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  async proposeMilestones(args: ProposeMilestonesArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    const artifacts = await this.ctx.project(live.projectId).load();
    const renames = this.ctx.plan.freshRefs(
      live,
      args.milestones.flatMap((m) => m.tasks),
    );
    const milestones = args.milestones.map((m) => ({
      ...m,
      tasks: m.tasks.map((t) => withRefs(t, renames)),
    }));
    const all = milestones.flatMap((m) => m.tasks);
    const problem = this.ctx.plan.checkTasks(live, artifacts, all);
    if (problem) return { text: problem, isError: true };
    const titles = this.ctx.plan.titlesByRef(live, artifacts, all);
    const pending = this.ctx.proposals
      .proposals(live)
      .filter((p) => p.proposal.type === 'plan' && p.proposal.milestone?.isNew).length;
    const first =
      nextNumber(
        artifacts.milestones.map((m) => m.id),
        /^M(\d+)$/,
      ) + pending;
    const h = headings(this.ctx.deps.locale());
    const shown = milestones.map((m, i) => {
      const id = `M${String(first + i).padStart(2, '0')}`;
      this.ctx.proposals.addProposal(
        live,
        {
          type: 'plan',
          milestone: {
            id,
            title: m.title,
            body: `## ${h.goal}\n\n${m.goal}\n\n## ${h.done}\n\n${m.doneWhen}\n`,
            isNew: true,
          },
          tasks: m.tasks.map((t) => this.ctx.plan.proposedTask(t, titles)),
        },
        'pending',
      );
      return `${id} "${m.title}" (${m.tasks.length} tasks)`;
    });
    return {
      text:
        `Shown to the user as cards: ${shown.join(', ')}. Only the tasks the user picks are ` +
        'created; the decision comes with their next message.' +
        this.ctx.plan.renamedNote(renames) +
        ' Continue.',
    };
  }

  async proposeTasks(args: ProposeTasksArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    const artifacts = await this.ctx.project(live.projectId).load();
    const milestone = args.milestone
      ? artifacts.milestones.find((m) => m.id.toUpperCase() === args.milestone!.toUpperCase())
      : undefined;
    if (args.milestone && !milestone) {
      return { text: `There is no milestone ${args.milestone}.`, isError: true };
    }
    const renames = this.ctx.plan.freshRefs(live, args.tasks);
    const tasks = args.tasks.map((t) => withRefs(t, renames));
    const problem = this.ctx.plan.checkTasks(live, artifacts, tasks);
    if (problem) return { text: problem, isError: true };
    const titles = this.ctx.plan.titlesByRef(live, artifacts, tasks);
    this.ctx.proposals.addProposal(
      live,
      {
        type: 'plan',
        ...(milestone
          ? { milestone: { id: milestone.id, title: milestone.title, isNew: false } }
          : {}),
        tasks: tasks.map((t) => this.ctx.plan.proposedTask(t, titles)),
      },
      'pending',
    );
    return {
      text:
        `${tasks.length} tasks are shown to the user as a card; only the ones the user ` +
        'picks are created. The decision comes with their next message.' +
        this.ctx.plan.renamedNote(renames) +
        ' Continue.',
    };
  }

  async updateTask(args: UpdateTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    const artifacts = await this.ctx.project(live.projectId).load();
    const task = artifacts.tasks.find((t) => t.id.toUpperCase() === args.id.toUpperCase());
    if (!task) return { text: `There is no task ${args.id}.`, isError: true };
    const ids = new Set(artifacts.tasks.map((t) => t.id));
    const deps = args.dependsOn?.map((d) => d.toUpperCase());
    const unknown = deps?.filter((d) => !ids.has(d) || d === task.id) ?? [];
    if (unknown.length) {
      return {
        text: `depends_on must list other existing tasks; not valid: ${unknown.join(', ')}.`,
        isError: true,
      };
    }
    const milestone = args.milestone
      ? artifacts.milestones.find((m) => m.id.toUpperCase() === args.milestone!.toUpperCase())
      : undefined;
    if (args.milestone && !milestone) {
      return { text: `There is no milestone ${args.milestone}.`, isError: true };
    }
    const body =
      args.goal !== undefined || args.criteria !== undefined || args.notes !== undefined
        ? withSections(
            task.body,
            {
              ...(args.goal !== undefined ? { goal: args.goal } : {}),
              ...(args.criteria !== undefined ? { criteria: args.criteria } : {}),
              ...(args.notes !== undefined ? { notes: args.notes } : {}),
            },
            this.ctx.deps.locale(),
          )
        : undefined;
    const patch = {
      ...(args.title && args.title !== task.title ? { title: args.title } : {}),
      ...(body !== undefined && body !== task.body ? { body } : {}),
      ...(deps && deps.join() !== task.dependsOn.join() ? { dependsOn: deps } : {}),
      ...(milestone && milestone.id !== task.milestone ? { milestone: milestone.id } : {}),
    };
    if (!Object.keys(patch).length) return { text: `${task.id} already looks like this.` };
    const after: Task = { ...task, ...patch };
    this.ctx.proposals.addProposal(
      live,
      {
        type: 'task',
        id: task.id,
        title: after.title,
        before: taskText(task),
        after: taskText(after),
        patch,
      },
      'pending',
    );
    return {
      text:
        `The change to ${task.id} is shown to the user as a card. The decision comes with their ` +
        'next message; continue.',
    };
  }
}
