import type { TaskRunEngine } from './task-run-engine';
import { retireIntegration } from './integration-retire';
import { integrationRetirementEligible } from './integration-retirement-policy';
import { retirePublishedLocalCandidate } from './completed-local-candidates';

/** Retire proven published local candidates; never recover, enqueue or call a model. */
export async function cleanCompletedIntegrations(ctx: TaskRunEngine): Promise<void> {
  for (const project of ctx.deps.db.listProjects()) {
    if (ctx.closing || ctx.integrations.closing) return;
    if (ctx.deps.db.shell.projectScope && ctx.deps.db.shell.projectScope !== project.id) continue;
    for (const saved of ctx.integrations.store.all(project.id)) {
      if (ctx.closing || ctx.integrations.closing) return;
      const op = await retirePublishedLocalCandidate(ctx, saved).catch((error: unknown) => {
        ctx.deps.db.addEvent(project.id, 'resource_retained', {
          integration: saved.id,
          reason: 'local-publication-unavailable',
        });
        console.error(`local candidate ${saved.id} retirement:`, error);
        return saved;
      });
      if (integrationRetirementEligible(op) && !ctx.integrations.executing(op.id))
        await retireIntegration(ctx, op);
    }
  }
}
