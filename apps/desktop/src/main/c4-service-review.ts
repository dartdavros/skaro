import { C4ValidationError, type AppDb } from '@skaro/core';
import type { ReviewC4Args, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { Projects } from './projects';
import type { C4ProposalRecord } from './c4-service';
import { writeC4TaskReview } from './c4-review-write';
import { recordC4Diagnostic, c4ToolFailure } from './c4-tool-diagnostic';

export async function legacyC4ServiceReview(
  deps: { db: AppDb; projects: Projects; changed(project: string): void },
  args: ReviewC4Args,
  scope: SkaroScope,
  checkout: string,
  records: () => Promise<C4ProposalRecord[]>,
): Promise<ToolResult> {
  try {
    const result = await writeC4TaskReview(
      deps.db,
      deps.projects.get(scope.projectId),
      checkout,
      args,
      scope,
      async () =>
        (await records()).some(
          (r) =>
            r.package.task?.id === scope.taskId && ['pending', 'accepted'].includes(r.item.state),
        ),
    );
    recordC4Diagnostic(deps.db, scope, null);
    deps.changed(scope.projectId);
    return result;
  } catch (error) {
    recordC4Diagnostic(
      deps.db,
      scope,
      error instanceof C4ValidationError ? error.diagnostic : null,
    );
    deps.changed(scope.projectId);
    return c4ToolFailure(error);
  }
}
