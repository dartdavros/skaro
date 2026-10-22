import type { Services } from './app-services';
import type { OwnerCommands } from './owner-commands';
import type { Updates } from './update-controller';
import type { HistoryReads } from './history-read-service';
import { closeNativeSessions } from './native/client';
import { closeBackground } from './background/client';
import { trace } from './trace';

async function settle(actions: (() => void | Promise<unknown>)[]): Promise<void> {
  const results = await Promise.allSettled(actions.map((action) => Promise.resolve().then(action)));
  for (const result of results)
    if (result.status === 'rejected') console.error('Service shutdown:', result.reason);
}

export async function shutdownApp(
  services: Services,
  commands: OwnerCommands,
  updates: Updates,
  historyReads: HistoryReads,
): Promise<void> {
  trace('before quit');
  updates.stop();
  await settle([closeNativeSessions]);
  await settle([() => commands.close()]);
  await settle([() => services.ci.close()]);
  await settle([
    () => services.runs.close(),
    () => services.chats.close(),
    () => services.mcp.close(),
    () => services.graph.close(),
  ]);
  trace('runs and mcp server closed');
  await settle([() => services.projects.close()]);
  await settle([() => historyReads.close()]);
  await settle([closeBackground]);
}
