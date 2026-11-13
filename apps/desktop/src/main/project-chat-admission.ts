import { realpath } from 'node:fs/promises';
import { resourceId, type AppDb } from '@skaro/core';
import type { ApplicationResources } from './application-resources';

/** Chat topics share one exclusive project executor, including any commands surviving a turn. */
export async function projectChatTurn(
  db: AppDb,
  resources: ApplicationResources,
  projectId: string,
  account: string,
  needsWork: boolean,
) {
  if (!needsWork) return resources.modelWork(account, false);
  const project = db.getProject(projectId);
  if (!project) throw new Error('Project chat owner no longer exists');
  const path = await realpath(project.path);
  const resource =
    db.resources.get(resourceId({ projectId, kind: 'worktree', identity: { path } })) ??
    db.resources.register({
      projectId,
      kind: 'worktree',
      identity: { path },
      owner: { kind: 'project', id: projectId },
      purpose: 'worktree',
      ownership: 'registered',
      preservation: 'persistent',
      generation: 1,
      consumers: [],
      state: 'available',
    });
  const lock = await resources.acquire('review', undefined, {
    checkpoint: 'project-chat-controller',
    cost: {
      ramBytes: 0,
      cpuMillis: 0,
      model: 0,
      environment: 0,
      build: 0,
      review: 0,
      diskBytes: {},
    },
    locks: [{ resourceId: resource.id, generation: resource.generation, mode: 'exclusive' }],
  });
  try {
    const held = await resources.modelWork(account, true);
    let remaining = held.work ? 2 : 1;
    const wrap = <T extends { release(evidence: string): void }>(part: T): T => {
      let released = false;
      return {
        ...part,
        release: (evidence: string) => {
          if (released) return;
          part.release(evidence);
          released = true;
          if (--remaining === 0) lock.release('project_chat_execution_settled');
        },
      };
    };
    return { ...wrap(held), ...(held.work ? { work: wrap(held.work) } : {}) };
  } catch (error) {
    lock.release('project_chat_dispatch_not_started');
    throw error;
  }
}
