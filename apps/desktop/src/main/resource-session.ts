import type { AppDb } from '@skaro/core';
import type { SessionOptions } from '@skaro/timeline';
import { resourcesFor } from './resource-execution';
import { createHash, randomUUID } from 'node:crypto';
import { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import { realpath } from 'node:fs/promises';
import { projectChatTurn } from './project-chat-admission';

/** Trusted host owner/account binding. No credentials enter the resource journal. */
export function resourceSessionAdmission(
  db: AppDb,
  projectId: string,
  ownerId: string,
  account: string,
  requireCurrent: () => void | Promise<void>,
  cwd?: string,
  processKey?: string,
  observe?: (state: 'resource' | 'model' | 'running') => void,
): SessionOptions['resourceAdmission'] {
  const resources = resourcesFor(db);
  if (!resources) return undefined;
  const intentId = randomUUID();
  const identityOf = (connectionId?: string) => {
    let identity = account;
    if (connectionId) {
      const connection = new BuiltinModelConfigurationStore(db)
        .read()
        .connections.find((c) => c.id === connectionId);
      if (!connection) throw new Error('Resource account connection no longer exists');
      identity = `credential:${createHash('sha256').update(connection.credential.id).digest('hex')}`;
    }
    return identity;
  };
  const reserve = (
    kind: 'process' | 'model',
    signal: AbortSignal,
    connectionId?: string,
    needsWork = true,
  ) => {
    const identity = identityOf(connectionId);
    observe?.(kind === 'model' ? 'model' : 'resource');
    return resources
      .scope(
        projectId,
        ownerId,
        async () => {
          if (kind === 'model')
            return ownerId.startsWith('chat:')
              ? projectChatTurn(db, resources, projectId, identity, needsWork)
              : resources.modelWork(identity, needsWork);
          if (processKey) resources.reconcileProcess(projectId, processKey);
          const path = cwd ? await realpath(cwd) : undefined;
          const resource =
            path &&
            !ownerId.startsWith('chat:') &&
            db.resources
              .list(projectId)
              .find((record) => record.kind === 'worktree' && record.identity.path === path);
          return resources.acquire('process', undefined, {
            checkpoint: `process:${processKey ?? ownerId}`,
            locks: resource
              ? [
                  {
                    resourceId: resource.id,
                    generation: resource.generation,
                    mode: 'shared',
                  },
                ]
              : [],
          });
        },
        { signal, requireCurrent, intentId },
      )
      .then((value) => {
        observe?.('running');
        return value;
      });
  };
  return {
    process: (signal) => reserve('process', signal),
    turn: (signal, connection, needsWork) => reserve('model', signal, connection, needsWork),
    limits: (state, resetsAt, connection) =>
      resources.observeQuota(identityOf(connection), state, resetsAt),
  };
}
