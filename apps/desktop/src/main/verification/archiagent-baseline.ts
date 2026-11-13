import assert from 'node:assert/strict';
import type { Services } from '../app-services';
import { coordinationHash } from '../project-coordinator-request';
import { coordinatorHistoryAudit, prefixHash } from './coordinator-history-audit';
import { coordinatorSourceAudit } from './coordinator-source-audit';

export async function archiagentBaseline(s: Services, project: string, data: string) {
  const context = s.projects.get(project),
    artifacts = await context.load();
  const history = await coordinatorHistoryAudit(s.db, data, project);
  const chats = [
    ...s.db.listChats(project, { includeTasks: true }),
    ...s.db.listChats(project, { archived: true, includeTasks: true }),
  ];
  const runs = s.db.listRuns(project, undefined, { includeRetired: true });
  const keys = [
    ...new Set([
      ...chats.map((c) => `chat.${c.id}.agent`),
      ...runs.map((r) => `task.${project}.${r.taskId}.agent`),
    ]),
  ];
  return {
    history,
    permissions: keys.map((key) => ({
      key,
      hash: coordinationHash(s.db.getSetting(key, null, { strict: true })),
    })),
    runs: runs.map((r) => ({
      id: r.id,
      task: r.taskId,
      agent: r.agent,
      worktree: r.worktree,
      log: r.logPath,
      binding: s.db.getSetting(`c4.coordination.run.${r.id}`, null, { strict: true }),
    })),
    tasks: artifacts.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      dependsOn: t.dependsOn,
      unblocked: t.unblocked,
      spec: t.spec,
    })),
    packages: (await s.c4.records(project)).map((r) => ({
      id: r.item.id,
      state: r.item.state,
      hash: coordinationHash({
        package: r.package,
        files: r.fileIndex,
        scope: r.scope,
        protocol: r.protocol,
      }),
    })),
    source: await coordinatorSourceAudit(context.root),
    policy: s.runs['engine'].incidents.policy.read(project),
    resources: s.db.getSetting('resources.policy.v1', {}, { strict: true }),
  };
}
export async function assertArchiagentPreserved(
  before: Awaited<ReturnType<typeof archiagentBaseline>>,
  s: Services,
  project: string,
  data: string,
  mutableTaskBodies: readonly string[] = [],
  expectedSource?: Awaited<ReturnType<typeof coordinatorSourceAudit>>,
) {
  const after = await archiagentBaseline(s, project, data);
  for (const row of before.history.references)
    assert.deepEqual(
      after.history.references.find((next) => next.id === row.id),
      row,
    );
  for (const log of before.history.logs)
    if (!log.missing) assert.equal(await prefixHash(log.path, log.bytes!), log.hash);
  for (const row of before.permissions)
    assert.deepEqual(
      after.permissions.find((next) => next.key === row.key),
      row,
    );
  for (const row of before.runs)
    assert.deepEqual(
      after.runs.find((next) => next.id === row.id),
      row,
    );
  for (const row of before.tasks)
    assert.deepEqual(
      mutableTaskBodies.includes(row.id)
        ? { ...after.tasks.find((next) => next.id === row.id), body: row.body }
        : after.tasks.find((next) => next.id === row.id),
      row,
    );
  for (const row of before.packages)
    assert.deepEqual(
      after.packages.find((next) => next.id === row.id),
      row,
    );
  assert.deepEqual(after.source, expectedSource ?? before.source);
  assert.deepEqual(after.resources, before.resources);
  // Policy revision may advance after a bounded owner-authorized test; its semantics must be restored.
  const { revision: _beforeRevision, ...oldPolicy } = before.policy;
  const { revision: _afterRevision, ...newPolicy } = after.policy;
  assert.deepEqual(newPolicy, oldPolicy);
  return {
    histories: before.history.references.length,
    sourcePreserved: !expectedSource,
    authorizedSourceChangeVerified: !!expectedSource,
    authorizedTaskBodiesUpdated: mutableTaskBodies,
    originalSettingsAndBindingsPreserved: true,
    originalCriteriaAndPackagesPreserved: true,
  };
}
