import { parseRemedyPolicy, type AppDb } from '@skaro/core';
import { coordinationHash } from './project-coordinator-request';
import { hasOwnerOrigin } from './owner-command-provenance';
import type { CoordinatorMigration } from '../shared/coordination-control';
/** Metadata-only onboarding: canonical histories, worker settings and existing decisions are never rewritten. */
export function migrateCoordinatorProject(db: AppDb, projectId: string): CoordinatorMigration {
  if ((db.shell.projectScope && db.shell.projectScope !== projectId) || !db.getProject(projectId))
    throw new Error('Coordinator migration scope invalid');
  const controller = db.coordination.ensure(projectId),
    key = `coordination.migration.v1.${projectId}`;
  const previous = db.getSetting<CoordinatorMigration | undefined>(key, undefined, {
    strict: true,
  });
  if (previous !== undefined && previous?.version !== 1) return { ...previous, blocked: true };
  const chats = [
    ...db.listChats(projectId, { includeTasks: true }),
    ...db.listChats(projectId, { archived: true, includeTasks: true }),
  ];
  const runs = db.listRuns(projectId, undefined, { includeRetired: true });
  let blocked = false,
    legacyIntentsStopped = 0,
    ambiguousCommands = 0;
  for (const run of runs) {
    const name = `execution.${run.id}`;
    try {
      const execution = db.getSetting<{ enabled: boolean; stalls: number } | undefined>(
        name,
        undefined,
        { strict: true },
      );
      if (execution === undefined) {
        if (db.settings.compareAndSet(name, undefined, { enabled: false, stalls: 0 }))
          legacyIntentsStopped++;
      } else if (
        typeof execution?.enabled !== 'boolean' ||
        !Number.isSafeInteger(execution?.stalls) ||
        execution.stalls < 0
      )
        blocked = true;
    } catch {
      blocked = true;
    }
  }
  let policy: CoordinatorMigration['policy'] = 'existing-owner-policy';
  try {
    const name = `coordination.policy.${projectId}`;
    const saved = db.getSetting<{ revision: number } | undefined>(name, undefined, {
      strict: true,
    });
    if (saved !== undefined) parseRemedyPolicy(saved, saved?.revision);
    else {
      policy = 'confirm-default';
      db.settings.compareAndSet(name, undefined, {
        revision: 0,
        mode: 'confirm',
        expiresAt: Number.MAX_SAFE_INTEGER,
        rules: [],
        denied: [],
      });
    }
  } catch {
    blocked = true;
  }
  for (const command of db.commands.pending()) {
    if (command.args[0] !== projectId || hasOwnerOrigin(db, command)) continue;
    // Do not turn a legacy inbox row into authorization. Arguments/history remain recoverable.
    db.commands.update(
      command.id,
      'uncertain',
      'Legacy delivery has no verified current owner intent. Review the saved conversation before resending.',
    );
    ambiguousCommands++;
  }
  const fingerprint = coordinationHash({
    chats: chats.map((c) => [c.id, c.agent, c.logPath]),
    runs: runs.map((r) => [r.id, r.taskId, r.agent, r.logPath]),
  });
  const result: CoordinatorMigration = {
    version: 1,
    controllerId: controller.id,
    fingerprint,
    blocked,
    chats: chats.length,
    runs: runs.length,
    legacyIntentsStopped: (previous?.legacyIntentsStopped ?? 0) + legacyIntentsStopped,
    ambiguousCommands: (previous?.ambiguousCommands ?? 0) + ambiguousCommands,
    legacyBlockers: db.coordination.blockers.list(projectId).filter((b) => !b.protocol).length,
    policy: previous?.policy ?? policy,
  };
  if (JSON.stringify(previous) !== JSON.stringify(result)) db.setSetting(key, result);
  return result;
}
