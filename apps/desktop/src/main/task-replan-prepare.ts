import type { ProjectArtifacts, Task } from '@skaro/core';
import type { ReplanTasksArgs } from '@skaro/mcp-server';
import type { ReplanTask, TaskReplanProposal } from '@skaro/timeline';
import { adrId, findCycle, taskText } from './chat-proposal-helpers';
import { taskBody, taskSections } from './task-body';
import { assertReplanArtifacts, fingerprint, replanContextFingerprint } from './task-replan-guard';

const unique = (values: string[]) => [...new Set(values)];

export function replanText(tasks: (ReplanTask | Task)[]): string {
  return tasks
    .map((task) =>
      [
        `## ${task.id ?? ('ref' in task ? task.ref : '')}`,
        ...('sources' in task ? [`sources: ${task.sources.join(', ')}`] : []),
        `order: ${task.order ?? 0}`,
        ...(task.spec ? [`spec: ${task.spec}`] : []),
        taskText(task),
      ].join('\n'),
    )
    .join('\n');
}

/** Build the entire replacement graph, including incoming edges from outside its sources. */
export function prepareTaskReplan(
  args: ReplanTasksArgs,
  artifacts: ProjectArtifacts,
  locale: string,
): TaskReplanProposal {
  assertReplanArtifacts(artifacts);
  const originals = args.taskIds.map((id) => {
    const task = artifacts.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`There is no task ${id}.`);
    return task;
  });
  const sourceIds = new Set(args.taskIds);
  const deleted = new Set(args.deleteIds ?? []);
  if (
    deleted.size !== (args.deleteIds?.length ?? 0) ||
    [...deleted].some((id) => !sourceIds.has(id))
  )
    throw new Error('Deleted tasks must be distinct source IDs.');
  if (!args.tasks.length && !deleted.size)
    throw new Error('A replan needs outputs or explicit deletions.');
  if (args.revisionReason !== undefined && !args.revisionReason.trim())
    throw new Error('A scope revision needs a reason.');
  const retained = new Set<string>();
  const refs = new Set(args.tasks.map((t) => t.ref));
  if (refs.size !== args.tasks.length || [...refs].some((ref) => /^T-\d+$/i.test(ref)))
    throw new Error('Result refs must be unique local keys, not task IDs.');
  const outputs: ReplanTask[] = args.tasks.map((input) => {
    const id = input.id?.toUpperCase();
    if (id && (!sourceIds.has(id) || retained.has(id) || !input.sources.includes(id)))
      throw new Error(`Retained ID ${id} must occur once and be one of this output's sources.`);
    if (id) retained.add(id);
    if (input.sources.some((source) => !sourceIds.has(source)))
      throw new Error(`${input.ref}: sources must belong to task_ids.`);
    if (!input.sources.length || input.sources.some((source) => deleted.has(source)))
      throw new Error(`${input.ref}: deleted tasks cannot also have replacements.`);
    const sources = originals.filter((t) => input.sources.includes(t.id));
    const specs = unique(sources.flatMap((t) => (t.spec ? [adrId(t.spec)] : [])));
    const spec = input.spec ? adrId(input.spec) : specs[0];
    if (specs.length > 1 || (specs.length && spec !== specs[0]))
      throw new Error(
        `${input.ref}: preserve the source specification; tasks with different specs need separate outputs.`,
      );
    if (spec && !artifacts.specs.some((s) => s.id === spec && s.status === 'accepted'))
      throw new Error(`${input.ref}: SPEC-${spec} is not accepted.`);
    const milestone = input.milestone?.toUpperCase();
    if (milestone && !artifacts.milestones.some((m) => m.id === milestone))
      throw new Error(`There is no milestone ${milestone}.`);
    return {
      ...(input.requiresPullRequest || sources.some((source) => source.requiresPullRequest)
        ? { requiresPullRequest: true }
        : {}),
      ref: input.ref,
      ...(id ? { id } : {}),
      sources: input.sources,
      title: input.title,
      body: `\n${taskBody(input, locale)}`,
      dependsOn: input.dependsOn,
      ...(milestone ? { milestone } : {}),
      order: input.order,
      ...(spec ? { spec } : {}),
    };
  });
  for (const source of originals) {
    if (deleted.has(source.id)) continue;
    if (!outputs.some((t) => t.sources.includes(source.id)))
      throw new Error(
        `${source.id}: every source must have a replacement; dropping work is not replanning.`,
      );
    if (args.revisionReason) continue;
    const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
    const covered = new Set(
      outputs
        .filter((t) => t.sources.includes(source.id))
        .flatMap((t) => taskSections(t.body).criteria.map((c) => normalize(c.text))),
    );
    const missing = taskSections(source.body).criteria.filter(
      (c) => !covered.has(normalize(c.text)),
    );
    if (missing.length)
      throw new Error(
        `${source.id}: source acceptance criteria must be preserved: ${missing.map((c) => c.text).join('; ')}`,
      );
  }
  const replacements = new Map(
    originals.map((source) => [
      source.id,
      outputs.filter((task) => task.sources.includes(source.id)).map((task) => task.id ?? task.ref),
    ]),
  );
  const externalIds = new Set(artifacts.tasks.filter((t) => !sourceIds.has(t.id)).map((t) => t.id));
  const resolve = (dependency: string): string[] => {
    if (refs.has(dependency)) {
      const task = outputs.find((t) => t.ref === dependency)!;
      return [task.id ?? task.ref];
    }
    const id = dependency.toUpperCase();
    if (replacements.has(id)) return replacements.get(id)!;
    if (externalIds.has(id)) return [id];
    throw new Error(`Unknown dependency ${dependency}.`);
  };
  for (const task of outputs) {
    if (task.dependsOn.some((id) => deleted.has(id.toUpperCase())))
      throw new Error(`${task.ref}: explicit dependencies cannot reference deleted tasks.`);
    const explicit = task.dependsOn.flatMap(resolve);
    if (explicit.includes(task.id ?? task.ref))
      throw new Error(`${task.ref}: a task cannot depend on itself.`);
    const inherited = originals
      .filter((s) => task.sources.includes(s.id))
      .flatMap((s) => s.dependsOn)
      .flatMap(resolve)
      .filter((ref) => ref !== (task.id ?? task.ref));
    task.dependsOn = unique([...(args.revisionReason ? [] : inherited), ...explicit]);
  }
  const external = artifacts.tasks.filter((t) => !sourceIds.has(t.id));
  const rewired = external.flatMap((task) => {
    const dependsOn = unique(task.dependsOn.flatMap(resolve));
    return JSON.stringify(dependsOn) === JSON.stringify(task.dependsOn)
      ? []
      : [{ id: task.id, dependsOn }];
  });
  const graph = [
    ...outputs.map((t) => ({ ref: t.id ?? t.ref, dependsOn: t.dependsOn })),
    ...external.map((t) => ({
      ref: t.id,
      dependsOn: rewired.find((r) => r.id === t.id)?.dependsOn ?? t.dependsOn,
    })),
  ];
  const cycle = findCycle(graph);
  if (cycle) throw new Error(`Replan dependencies form a cycle: ${cycle.join(' → ')}.`);
  const dependents = rewired.map((r) => external.find((t) => t.id === r.id)!);
  return {
    type: 'task_replan',
    key: args.key,
    requestFingerprint: fingerprint(args),
    title: args.title,
    taskIds: args.taskIds,
    tasks: outputs,
    rewired,
    before: replanText([...originals, ...dependents]),
    after: replanText([
      ...outputs,
      ...dependents.map((t) => ({
        ...t,
        dependsOn: rewired.find((r) => r.id === t.id)!.dependsOn,
      })),
    ]),
    snapshot: artifacts.tasks.map((task) => ({ id: task.id, fingerprint: fingerprint(task) })),
    contextFingerprint: replanContextFingerprint(artifacts),
  };
}
