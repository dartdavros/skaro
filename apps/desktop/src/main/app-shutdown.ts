import type { Services } from './app-services';
import type { OwnerCommands } from './owner-commands';
import type { Updates } from './update-controller';
import type { HistoryReads } from './history-read-service';
import { closeNativeSessions } from './native/client';
import { closeBackground } from './background/client';
import { trace } from './trace';

async function settle(stage: string, actions: (() => void | Promise<unknown>)[]): Promise<void> {
  trace(`shutdown ${stage}: start`);
  const results = await Promise.allSettled(actions.map((action) => Promise.resolve().then(action)));
  for (const result of results)
    if (result.status === 'rejected') console.error('Service shutdown:', result.reason);
  trace(`shutdown ${stage}: settled`);
}

export async function shutdownApp(
  services: Services,
  commands: OwnerCommands,
  updates: Updates,
  historyReads: HistoryReads,
): Promise<void> {
  trace('before quit');
  updates.stop();
  services.coordinators.stopAccepting();
  services.resources.stopAccepting();
  await settle('c4 audits', [() => services.c4Audits.close()]);
  await settle('native sessions', [closeNativeSessions]);
  await settle('model catalog', [() => services.modelCatalog.close()]);
  await settle('model settings', [() => services.modelSettings.close()]);
  await settle('owner commands', [() => commands.close()]);
  await settle('ci', [() => services.ci.close()]);
  await settle('runs, chats, mcp, graph', [
    () => services.runs.close(),
    () => services.chats.close(),
    () => services.mcp.close(),
    () => services.graph.close(),
  ]);
  trace('runs and mcp server closed');
  await settle('managed caches', [() => services.managedCaches.close()]);
  await settle('coordinators', [() => services.coordinators.close()]);
  await settle('resources', [() => services.resources.close()]);
  await settle('projects', [() => services.projects.close()]);
  await settle('history reads', [() => historyReads.close()]);
  await settle('background', [closeBackground]);
}
