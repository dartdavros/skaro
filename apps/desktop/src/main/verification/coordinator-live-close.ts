import type { Services } from '../app-services';
import { closeNativeSessions } from '../native/client';
import { closeBackground } from '../background/client';
export async function closeCoordinatorVerification(s: Services) {
  s.coordinators.stopAccepting();
  s.resources.stopAccepting();
  await closeNativeSessions();
  const actions = [
    () => s.commands.close(),
    () => s.runs.close(),
    () => s.chats.close(),
    () => s.managedCaches.close(),
    () => s.ci.close(),
    () => s.mcp.close(),
    () => s.graph.close(),
    () => s.modelCatalog.close(),
    () => s.modelSettings.close(),
    () => s.coordinators.close(),
    () => s.resources.close(),
    () => s.projects.close(),
    closeBackground,
  ];
  const errors: unknown[] = [];
  for (const action of actions)
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  if (errors.length) throw new AggregateError(errors, 'Verification shutdown incomplete');
}
