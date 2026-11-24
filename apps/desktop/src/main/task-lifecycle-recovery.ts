import type { TaskRunEngine } from './task-run-engine';
import { currentTransition, pendingTransitions, transitionPhase } from './task-lifecycle-journal';
import { parkTask, resumeParkedTask } from './task-park';
import { savedOwnerCommand } from './owner-command-evidence';
import { reportLifecycleConflict } from './task-lifecycle-conflict';
import { reconcileParkDelivery } from './task-park-delivery';

export async function recoverTaskTransitions(ctx: TaskRunEngine, project: string, token?: string) {
  const db = ctx.deps.db;
  for (const entry of pendingTransitions(db, project)) {
    if (token && entry.token !== token) continue;
    try {
      if (entry.target !== 'in_progress') {
        await parkTask(ctx, project, entry.id, entry.target, entry);
        const op =
          entry.commandId && db.coordination.getOperation(project, `park:${entry.commandId}`);
        if (op) reconcileParkDelivery(db, op);
        continue;
      }
      const requireCurrent = () => {
        if (
          currentTransition(db, project, entry.id)?.token !== entry.token ||
          db.latestRun(project, entry.id)?.id !== entry.run ||
          ctx.parking.has(`${project}\n${entry.id}`)
        )
          throw new Error('The resume request is no longer current');
      };
      requireCurrent();
      const command = entry.commandId && db.commands.get(entry.commandId);
      if (!(
        entry.phase === 'confirmed' ||
        (command &&
          command.owner === `${project}:${entry.id}` &&
          command.method === 'task.send' &&
          command.args[0] === project &&
          command.args[1] === entry.id &&
          (command.args[2] as { resumeTask?: boolean } | undefined)?.resumeTask === true &&
          (await savedOwnerCommand(db, ctx.deps.dataDir, command)))
      )) {
        await reportLifecycleConflict(ctx, project, entry);
        continue;
      }
      await resumeParkedTask(ctx, project, entry.id, requireCurrent);
      transitionPhase(db, project, entry, 'settled');
      ctx.changed(project, entry.id);
    } catch (error) {
      await reportLifecycleConflict(ctx, project, entry);
      console.error('Task lifecycle recovery:', project, entry.id, error);
    }
  }
}
