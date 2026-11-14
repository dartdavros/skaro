import type { Services } from './app-services';
import type { OwnerCommands } from './owner-commands';
import type { Updates } from './update-controller';
import type { HistoryReads } from './history-read-service';
import { closeNativeSessions } from './native/client';
import { closeBackground } from './background/client';
import { trace } from './trace';
import type { ShutdownProgress } from './shutdown-progress';
import { runShutdownStage } from './shutdown-stage';

export async function shutdownApp(
  services: Services,
  commands: OwnerCommands,
  updates: Updates,
  historyReads: HistoryReads,
  progress: ShutdownProgress,
): Promise<void> {
  trace('before quit');
  progress.begin();
  updates.stop();
  services.coordinators.stopAccepting();
  services.resources.stopAccepting();
  await runShutdownStage(progress, 'agents', [
    ['c4 audits', [() => services.c4Audits.close()]],
    ['native sessions', [closeNativeSessions]],
    ['model catalog', [() => services.modelCatalog.close()]],
    ['model settings', [() => services.modelSettings.close()]],
    ['owner commands', [() => commands.close()]],
  ]);
  await runShutdownStage(progress, 'environments', [
    ['ci', [() => services.ci.close()]],
    [
      'runs, chats, mcp, graph',
      [
        () => services.runs.close(),
        () => services.chats.close(),
        () => services.mcp.close(),
        () => services.graph.close(),
      ],
    ],
    ['managed caches', [() => services.managedCaches.close()]],
    ['coordinators', [() => services.coordinators.close()]],
    ['resources', [() => services.resources.close()]],
    ['projects', [() => services.projects.close()]],
  ]);
  trace('runs and mcp server closed');
  await runShutdownStage(progress, 'history', [['history reads', [() => historyReads.close()]]]);
  await runShutdownStage(progress, 'background', [['background', [closeBackground]]]);
}
