import { c4BodyHash, type ProjectArtifacts } from '@skaro/core';
import type { ReviewC4Args } from '@skaro/mcp-server';
import { reviewedC4Ids, taskC4Scope } from './c4-task-scope';

export function c4CoverageProblems(
  artifacts: Pick<ProjectArtifacts, 'c4' | 'tasks' | 'specs'>,
  taskId: string,
  review?: ReviewC4Args,
  scope = taskC4Scope(artifacts, taskId, []),
): string[] {
  const problems: string[] = [];
  if (scope.kind === 'artifacts') {
    if (review?.realized.length)
      problems.push('Artifact-only work cannot publish implemented architecture.');
    if (review && !review.aligned) problems.push('The agent reported an architectural mismatch.');
    return problems;
  }
  const model = artifacts.c4;
  if (!model)
    return [...problems, 'Prepare and accept the project C4 model before architecture acceptance.'];
  const task = artifacts.tasks.find((t) => t.id === taskId);
  const spec = task?.spec ? model.specifications.find((s) => s.id === task.spec) : undefined;
  if (task?.spec && !spec) problems.push(`SPEC-${task.spec}: missing C4 coverage`);
  const document = artifacts.specs.find((item) => item.id === task?.spec);
  if (spec && document && spec.bodyHash !== c4BodyHash(document.body))
    problems.push(`SPEC-${spec.id}: C4 binding is stale after document edits`);
  for (const requirement of scope.requirements)
    if (!spec?.requirements.some((item) => item.id === requirement))
      problems.push(`SPEC-${task?.spec}/${requirement}: missing task requirement coverage`);
  const affected = reviewedC4Ids(scope, review, model);
  for (const question of model.questions)
    if (question.affects.some((id) => affected.has(id)))
      problems.push(
        `${taskId}: ${question.id} blocks affected IDs ${question.affects.filter((id) => affected.has(id)).join(', ')}: ${question.question}`,
      );
  if (review) {
    if (!review.elements.length)
      problems.push('Review must identify the architectural elements inspected in code.');
    if (!review.aligned) problems.push('The agent reported an architectural mismatch.');
    if (review.revision !== model.revision)
      problems.push('C4 changed after review. Read context and review again.');
    for (const [field, entries] of [
      ['elements', model.elements],
      ['relationships', model.relationships],
    ] as const)
      for (const id of review[field])
        if (!entries.some((e) => e.id === id)) problems.push(`Unknown ${field}: ${id}`);
    for (const id of scope.elements)
      if (!review.elements.includes(id)) problems.push(`Review must cover task element ${id}`);
    for (const id of scope.relationships)
      if (!review.relationships.includes(id))
        problems.push(`Review must cover task relationship ${id}`);
    for (const id of review.realized) {
      const entry = [...model.elements, ...model.relationships].find((e) => e.id === id);
      if (
        !entry ||
        ![...review.elements, ...review.relationships].includes(id) ||
        (entry.state !== 'planned' && !entry.planned && !model.removals?.some((r) => r.id === id))
      )
        problems.push(`Realization ${id} must be a reviewed planned change`);
    }
  }
  return problems;
}
