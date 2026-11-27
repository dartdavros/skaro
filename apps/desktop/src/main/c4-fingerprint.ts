import { authoredBody, c4Hash, type ProjectArtifacts } from '@skaro/core';
import type { C4TaskScope } from './c4-task-scope';

export const c4ReviewKey = (projectId: string, taskId: string) =>
  `c4.review.${projectId}.${taskId}`;

export {
  checkoutDiffHash as c4DiffHash,
  checkoutChangeHash as c4ChangeHash,
} from './checkout-change-hash';

export function c4ArchitectureHash(artifacts: ProjectArtifacts, scope?: C4TaskScope): string {
  if (scope?.kind === 'artifacts') return c4Hash('artifact-only');
  if (scope)
    return c4Hash(
      JSON.stringify({
        elements: artifacts.c4?.elements.filter((item) => scope.elements.includes(item.id)),
        relationships: artifacts.c4?.relationships.filter((item) =>
          scope.relationships.includes(item.id),
        ),
        questions: artifacts.c4?.questions.filter((question) =>
          question.affects.some((id) => [...scope.elements, ...scope.relationships].includes(id)),
        ),
        specification: artifacts.c4?.specifications.find((item) => item.id === scope.spec),
        document: authoredBody(artifacts.specs.find((item) => item.id === scope.spec)?.body ?? ''),
      }),
    );
  return c4Hash(JSON.stringify({ model: artifacts.c4, problems: artifacts.c4Problems }));
}
