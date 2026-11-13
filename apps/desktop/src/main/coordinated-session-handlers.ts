import { randomUUID } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import type { Handlers } from './ipc';
import type { MethodName, MessageInput } from '../shared/ipc';
import type { ProjectCoordinators } from './project-coordinators';
import { coordinationHash } from './project-coordinator-request';
import { sessionCommand, sessionCommandScope } from './session-command-catalogue';
import { resourcesFor } from './resource-execution';
import { safetyDecisionMethod } from './decision-authority';

/** Transport admission only; the existing handler remains the sole executor. */
export function coordinatedSessionHandlers<T extends Partial<Handlers>>(
  handlers: T,
  coordinators: ProjectCoordinators,
  db: AppDb,
): T {
  return new Proxy(handlers, {
    get(target, property) {
      const method = property as MethodName;
      const handler = target[method] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof handler !== 'function') return handler;
      return (...args: unknown[]) => {
        const command =
          method === 'chat.create' ? (args[2] as MessageInput | undefined)?.commandId : undefined;
        // IPC has no general retry envelope. Each invocation is a distinct command.
        const id = command ? `chat-create:${command}` : `ipc:${randomUUID()}`;
        const descriptor = sessionCommand(method, args, id);
        if (!descriptor) return handler(...args);
        const { projectId, subject, mode } = descriptor;
        const version = coordinators.version(projectId);
        const existing = db.coordination.getOperation(projectId, id);
        return coordinators.execute(
          {
            id,
            projectId,
            action: `ipc.${method.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)}`,
            source: { kind: 'owner', id: 'renderer' },
            subject,
            inputHash: coordinationHash(args),
            mode,
            scopeKey: sessionCommandScope(descriptor, id),
            ...(mode === 'mutation'
              ? { expectedVersion: existing?.expectedVersion ?? version }
              : {}),
          },
          () => {
            const resources = resourcesFor(db);
            const effect = async () => handler(...args);
            return resources
              ? resources.scope(projectId, `${subject.kind}:${subject.id}`, effect, {
                  intentId: id,
                })
              : effect();
          },
          {
            whileSuspended: safetyDecisionMethod(method, args),
            evidence: () => ({ code: 'handler_returned', refs: [subject] }),
            ...(!descriptor.returnsValue ? { replay: () => undefined } : {}),
            ...(method === 'chat.create' && command
              ? {
                  replay: async () => {
                    const accepted = db.commands.get(command);
                    if (accepted?.method !== 'chat.send' || accepted.args[0] !== projectId)
                      throw new Error('The created chat has no matching delivery record');
                    const chat = (await handlers['chats.list']?.(projectId))?.find(
                      (item) => item.id === accepted.args[1],
                    );
                    if (!chat) throw new Error('The created chat is no longer available');
                    return chat;
                  },
                }
              : {}),
          },
        );
      };
    },
  });
}
