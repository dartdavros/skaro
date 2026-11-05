import type { ProjectContext } from './projects';
import type { IntegrationOperation } from './integration-model';
import { assertCandidateC4, candidateC4Model } from './c4-candidate';

/** Verify the architecture publication will actually use before declaring the candidate ready. */
export async function assertIntegrationC4(context: ProjectContext, op: IntegrationOperation) {
  if (op.purpose !== 'publication') return;
  context.invalidate();
  const artifacts = await context.load();
  if (!artifacts.c4) return;
  const candidate = {
    root: op.worktree,
    base: op.baseHead,
    head: op.localChanges ? op.publicationHead : op.head,
  };
  if (!candidate.head) throw new Error('Integration has no publication code tree.');
  const model = await candidateC4Model(
    artifacts.c4,
    op.results.flatMap((result) => result.c4?.realized ?? []),
    candidate,
  );
  await assertCandidateC4(model, candidate);
}
