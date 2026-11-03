import { background } from './background/client';
import type { Services } from './app-services';
import type { ModelUsageSummary } from '../shared/model-usage';
import { productUsageSources } from './builtin-product-usage-sources';
import { chatSessionsKey } from './builtin-chat-rebind';

/** Actual registered project only; no unrelated project discovery or model/network request. */
export async function productModelUsage(
  services: Pick<Services, 'db' | 'projects' | 'dataDir'>,
  projectId: string,
): Promise<ModelUsageSummary> {
  services.projects.get(projectId);
  const sessions = [
    ...productUsageSources(services.db, projectId),
    ...services.db
      .listRuns(projectId)
      .filter((entry) => entry.agent === 'skaro' && entry.nativeSessionId)
      .map((entry) => ({
        kind: 'tasks' as const,
        id: entry.id,
        sessionId: entry.nativeSessionId!,
      })),
    ...[
      ...services.db.listChats(projectId),
      ...services.db.listChats(projectId, { archived: true }),
    ]
      .filter((entry) => entry.agent === 'skaro')
      .flatMap((entry) =>
        [
          ...new Set([
            ...services.db.getSetting<string[]>(chatSessionsKey(entry.id), []),
            ...(entry.nativeSessionId ? [entry.nativeSessionId] : []),
          ]),
        ].map((sessionId) => ({ kind: 'chats' as const, id: entry.id, sessionId })),
      ),
  ];
  return background(services.dataDir, 'models.usage', projectId, sessions);
}
