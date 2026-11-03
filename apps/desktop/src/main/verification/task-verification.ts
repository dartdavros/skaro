import assert from 'node:assert/strict';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeVerificationHost } from '@skaro/agent-runtime';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import type { Services } from '../app-services';

/** Fixed registered project and actual OS owner; never fabricate an active run. */
export async function catPilotVerificationTarget(
  services: Services,
  owner: RuntimeProcessIdentity,
  sessionId: string,
  runId: string,
) {
  const projects = services.db.shell
    .list()
    .filter((item) => item.name.toLowerCase() === 'cat-pilot');
  assert.equal(projects.length, 1);
  const context = services.projects.get(projects[0]!.id);
  const task = await context.store.readTask('T-008');
  const scope = { kind: 'task' as const, projectId: context.id, taskId: task.id, runId };
  const admission = { id: `verification-${owner.pid}`, sessionId, generation: 1 };
  const verification: RuntimeVerificationHost = {
    scope,
    admission,
    acceptance: services.runs.builtinAcceptance(scope, {
      async requireActive(value, signal) {
        signal.throwIfAborted();
        assert.deepEqual(value, admission);
        assert.equal(await processBirth(owner.pid), owner.birth);
        signal.throwIfAborted();
      },
    }),
  };
  return { context, task, verification };
}
