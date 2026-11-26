import type { NewTask, Task } from '@skaro/core';
import type { TaskReplanProposal, TaskReplanProgress } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { TaskReplanDecision } from './task-replan-journal';
import { TaskReplanJournal } from './task-replan-journal';
import {
  assertReplanArtifacts,
  assertTasksUnstarted,
  fingerprint,
  replanContextFingerprint,
} from './task-replan-guard';
import { settingsKey } from './task-run-helpers';
import { taskFiles } from './task-replan-files';

export function taskInput(task: Task): NewTask {
  return {
    ...(task.requiresPullRequest && { requiresPullRequest: true }),
    title: task.title,
    body: task.body,
    dependsOn: task.dependsOn,
    milestone: task.milestone,
    order: task.order,
    spec: task.spec,
    agent: task.agent,
    model: task.model,
    created: task.created,
  };
}

export function afterTask(before: Task, input: NewTask): Task {
  return {
    ...before,
    requiresPullRequest: input.requiresPullRequest,
    title: input.title,
    body: input.body!,
    dependsOn: input.dependsOn!,
    milestone: input.milestone,
    order: input.order,
    spec: input.spec,
  };
}

export function matchesNew(task: Task, input: NewTask): boolean {
  return (
    fingerprint(taskInput(task)) === fingerprint(input) &&
    task.status === 'todo' &&
    !task.archived &&
    !task.unblocked &&
    !task.branch
  );
}

/** Allocation is durable before creation. A crash may skip an ID, never create duplicate work. */
export async function allocateReplan(ctx: ChatEngine, decision: TaskReplanDecision): Promise<void> {
  if (decision.phase !== 'allocating') return;
  const proposal = decision.item.proposal as TaskReplanProposal;
  const { store } = ctx.project(decision.projectId);
  const journal = new TaskReplanJournal(ctx.deps.db, decision.projectId);
  for (const task of proposal.tasks) {
    if (!decision.ids[task.ref]) {
      decision.ids[task.ref] = task.id ?? (await store.reserveTaskId());
      journal.save(decision);
    }
    if (!task.id && decision.preferences?.[task.sources[0]!])
      ctx.deps.db.setSetting(
        settingsKey(decision.projectId, decision.ids[task.ref]!),
        decision.preferences[task.sources[0]!]!,
      );
  }
  const resolve = (ref: string) => decision.ids[ref] ?? ref;
  decision.writes = proposal.tasks.map((task) => {
    const before = decision.before.find((t) => t.id === task.id);
    const source = before ?? decision.before.find((t) => t.id === task.sources[0])!;
    return {
      id: decision.ids[task.ref]!,
      ...(before ? { before } : {}),
      input: {
        ...taskInput(source),
        ...(task.requiresPullRequest && { requiresPullRequest: true }),
        title: task.title,
        body: task.body,
        milestone: task.milestone,
        order: task.order,
        spec: task.spec,
        dependsOn: task.dependsOn.map(resolve),
        created: before?.created ?? new Date().toISOString().slice(0, 10),
      },
    };
  });
  for (const rewired of proposal.rewired) {
    const before = decision.before.find((t) => t.id === rewired.id)!;
    decision.writes.push({
      id: before.id,
      before,
      input: { ...taskInput(before), dependsOn: rewired.dependsOn.map(resolve) },
    });
  }
  const retained = new Set(decision.writes.map((w) => w.id));
  decision.removes = decision.before.filter(
    (t) => proposal.taskIds.includes(t.id) && !retained.has(t.id),
  );
  decision.phase = 'writing';
  journal.save(decision);
}

/** Recognize both sides of each write so recovery also covers a crash before progress saving. */
export async function applyReplanWrites(
  ctx: ChatEngine,
  decision: TaskReplanDecision,
  progress?: (value: Omit<TaskReplanProgress, 'operation'>) => void,
): Promise<void> {
  const context = ctx.project(decision.projectId);
  const artifacts = await context.store.load();
  assertReplanArtifacts(artifacts);
  const proposal = decision.item.proposal as TaskReplanProposal;
  if (replanContextFingerprint(artifacts) !== proposal.contextFingerprint)
    throw new Error(
      'Specifications or milestones changed during replanning. Restore the reviewed context before recovery.',
    );
  const savedFiles = await taskFiles(
    context.root,
    artifacts.tasks.filter((t) => decision.afterFiles?.[t.id] !== undefined),
  );
  for (const [id, text] of Object.entries(savedFiles))
    if (text !== decision.afterFiles![id])
      throw new Error(`${id}: task file changed during replanning.`);
  for (const task of artifacts.tasks) {
    const write = decision.writes.find((w) => w.id === task.id);
    const before = decision.before.find((t) => t.id === task.id);
    if (write) {
      const matches = write.before
        ? fingerprint(task) === fingerprint(afterTask(write.before, write.input))
        : matchesNew(task, write.input);
      if (!matches && (!write.before || fingerprint(task) !== fingerprint(write.before)))
        throw new Error(`${task.id}: changed during replanning; recovery will not overwrite it.`);
    } else if (!before || fingerprint(task) !== fingerprint(before)) {
      throw new Error(`${task.id}: task graph changed during replanning.`);
    }
  }
  for (const before of decision.before) {
    if (
      !artifacts.tasks.some((t) => t.id === before.id) &&
      !decision.removes.some((t) => t.id === before.id)
    )
      throw new Error(`${before.id}: disappeared during replanning.`);
  }
  const touched = new Set([
    ...decision.writes.map((w) => w.id),
    ...decision.removes.map((t) => t.id),
  ]);
  await assertTasksUnstarted(
    ctx.deps.db,
    ctx.deps.dataDir,
    context,
    artifacts,
    artifacts.tasks.filter((t) => touched.has(t.id)).map((t) => t.id),
  );
  const counts = {
    writes: 0,
    totalWrites: decision.writes.length,
    removes: 0,
    totalRemoves: decision.removes.length,
  };
  progress?.({ ...counts });
  for (const write of decision.writes) {
    const current = artifacts.tasks.find((t) => t.id === write.id);
    if (write.before) {
      if (fingerprint(current!) !== fingerprint(afterTask(write.before, write.input))) {
        await context.store.updateTaskAtomically(write.id, {
          title: write.input.title,
          body: write.input.body,
          dependsOn: write.input.dependsOn,
          milestone: write.input.milestone,
          order: write.input.order,
          spec: write.input.spec,
          requiresPullRequest: write.input.requiresPullRequest,
        });
      }
    } else if (!current) await context.store.createReservedTask(write.id, write.input);
    decision.afterFiles = {
      ...decision.afterFiles,
      ...(await taskFiles(context.root, [await context.store.readTask(write.id)])),
    };
    counts.writes++;
    progress?.({ ...counts });
  }
  // Every incoming edge has been rewritten; deletion cannot silently drop a dependency.
  for (const task of decision.removes) {
    if (artifacts.tasks.some((t) => t.id === task.id))
      await context.store.deleteReplannedTask(
        task.id,
        decision.removes.map((t) => t.id),
      );
    counts.removes++;
    progress?.({ ...counts });
  }
  context.invalidate();
}
