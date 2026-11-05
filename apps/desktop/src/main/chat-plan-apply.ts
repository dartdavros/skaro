import type { AppDb, ArtifactStore, ProjectArtifacts } from '@skaro/core';
import type { Item, ProposalResult } from '@skaro/timeline';
import type { PlanProposal } from './chat-model';
import { adrId } from './chat-proposal-helpers';
import { planSpecProblem } from './chat-plan-specs';
import { checkedPlanDependencies } from './chat-plan-dependencies';
import { pendingC4PlanProblem } from './chat-plan-c4';

export async function applyChatPlan(options: {
  store: ArtifactStore;
  artifacts: ProjectArtifacts;
  db: AppDb;
  projectId: string;
  items: Item[];
  proposal: PlanProposal;
  picked?: string[];
}): Promise<{ result: ProposalResult; note: string }> {
  const { store, artifacts, db, projectId, items, proposal, picked } = options;
  const chosen = proposal.tasks.filter((t) => !picked || picked.includes(t.ref));
  const milestoneOnly = proposal.milestone?.isNew === true && proposal.tasks.length === 0;
  if (!chosen.length && !milestoneOnly) throw new Error('No tasks are selected');
  const architecture = await pendingC4PlanProblem(db, projectId, chosen);
  if (architecture) throw new Error(architecture);
  const specProblem = planSpecProblem(chosen, artifacts.specs, artifacts);
  if (specProblem) throw new Error(specProblem);
  const known = checkedPlanDependencies(chosen, items, artifacts);
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
  if (milestoneOnly) {
    result.tasks = [];
    db.addEvent(projectId, 'milestone_created', { milestone });
    return {
      result,
      note: `The user created milestone ${milestone} "${proposal.milestone!.title}" without tasks. Prepare specifications in this project chat before proposing its implementation tasks.`,
    };
  }

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
      ...(task.spec ? { spec: adrId(task.spec) } : {}),
    });
    known.set(task.ref, t.id);
    created.push({ id: t.id, title: t.title, ref: task.ref });
  }
  for (const [i, task] of chosen.entries()) {
    const ids = task.dependsOn.map((dep) => known.get(dep)!);
    if (ids.length) await store.updateTask(created[i]!.id, { dependsOn: ids });
  }
  result.tasks = created;
  db.addEvent(projectId, 'tasks_created', {
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
  ]
    .filter(Boolean)
    .join(' ');
  return { result, note };
}
